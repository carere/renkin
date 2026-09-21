import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { readStateAuth } from "@renkin/cloudflare-sdk/services/cloudflare-client/state-preview-client";
import { bundleWorker } from "@renkin/runtime/services/bundler/worker-bundler";
import { Effect } from "effect";
import { ensureCloudflareState } from "#src/contexts/root/services/state/bootstrap-cloudflare-state.ts";

const scope = () => {
  const env = process.env;
  const expiry = Date.parse(env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "");
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const managementToken = env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN;
  const prefix = env.RENKIN_CLOUDFLARE_TEST_PREFIX;
  if (
    env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_ENABLED !== "true" ||
    !Number.isFinite(expiry) ||
    Date.now() >= expiry ||
    !accountId ||
    !apiToken ||
    !managementToken ||
    !prefix
  )
    throw new Error("State authorization tests require current temporary-token authorization.");
  return { accountId, apiToken, managementToken, prefix, expiry };
};

const createToken = async (authorized: ReturnType<typeof scope>, permissionId: string) => {
  const tokenUrl = `https://api.cloudflare.com/client/v4/accounts/${authorized.accountId}/tokens`;
  const managementHeaders = {
    authorization: `Bearer ${authorized.managementToken}`,
    "content-type": "application/json",
  };
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: managementHeaders,
    body: JSON.stringify({
      name: `${authorized.prefix}-state-auth-${randomUUID()}`,
      expires_on: new Date(Math.min(authorized.expiry, Date.now() + 600_000))
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      policies: [
        {
          effect: "allow",
          permission_groups: [{ id: permissionId }],
          resources: { [`com.cloudflare.api.account.${authorized.accountId}`]: "*" },
        },
      ],
    }),
    redirect: "error",
  });
  const body = (await response.json()) as {
    success?: boolean;
    errors?: { code?: number }[];
    result?: { id?: string; value?: string };
  };
  if (!response.ok || !body.success || !body.result?.id || !body.result.value)
    throw new Error(
      `Could not create the temporary restricted test token (HTTP ${response.status}; codes ${body.errors?.map((error) => error.code).join(",") ?? "none"}).`,
    );
  return { id: body.result.id, value: body.result.value };
};

const assertTokenActive = async (accountId: string, token: string, workerRead: boolean) => {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}${workerRead ? "/workers/scripts" : ""}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
    });
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Restricted token never became usable for its authorized read operation.");
};

// Real restricted tokens exercise the provider permission boundary. Values stay in memory.
it.effect("rejects account-read and Worker-read credentials at the shared-state boundary", () =>
  Effect.promise(async () => {
    const authorized = scope();
    const state = await ensureCloudflareState({
      accountId: authorized.accountId,
      apiToken: authorized.apiToken,
      stateScriptName: `${authorized.prefix}-state-v2`,
    });
    const probe = await bundleWorker(
      fileURLToPath(
        new URL(
          "../../../../../src/contexts/root/services/state/auth-probe-worker.ts",
          import.meta.url,
        ),
      ),
    );
    const tokenUrl = `https://api.cloudflare.com/client/v4/accounts/${authorized.accountId}/tokens`;
    const managementHeaders = {
      authorization: `Bearer ${authorized.managementToken}`,
      "content-type": "application/json",
    };
    for (const permissionId of [
      "c1fde68c7bcc44588cbb6ddbc16d6480", // Account Settings Read
      "1a71c399035b4950a1bd1466bbe4f420", // Workers Scripts Read
    ]) {
      const { id, value } = await createToken(authorized, permissionId);
      const removeToken = async () => {
        const removed = await fetch(`${tokenUrl}/${id}`, {
          method: "DELETE",
          headers: managementHeaders,
          redirect: "error",
        });
        if (!removed.ok) throw new Error(`Temporary test token cleanup failed: ${id}`);
      };
      try {
        await assertTokenActive(
          authorized.accountId,
          value,
          permissionId === "1a71c399035b4950a1bd1466bbe4f420",
        );
        // A restricted API token must never double as the state bearer.
        const denied = await fetch(`${state.endpoint}/v1/list`, {
          method: "POST",
          headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
          body: JSON.stringify({ stack: `${authorized.prefix}-authorization` }),
          redirect: "error",
        });
        expect(denied.status).toBe(401);
        const recovered = await Effect.runPromise(
          readStateAuth(
            { accountId: authorized.accountId, apiToken: value },
            {
              endpoint: state.endpoint,
              scriptName: state.scriptName,
              probeSource: probe.code,
            },
          ).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
        );
        expect(recovered).toBe(false);
      } finally {
        await removeToken();
      }
    }
  }),
);
