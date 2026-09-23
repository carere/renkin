import { randomUUID } from "node:crypto";
import { listEnvironments } from "@carere/renkin";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

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
    signal: AbortSignal.timeout(15000),
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
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Restricted token never became usable for its authorized read operation.");
};

const observePermissionDenials = () => {
  const originalFetch = globalThis.fetch;
  let bearer = "";
  let count = 0;
  // Effect caches its default fetch service on first use. Install the observer before
  // the authorized control, then select the exact restricted bearer for each assertion.
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await originalFetch(
      new Request(request, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      }),
    );
    if (
      new URL(request.url).origin === "https://api.cloudflare.com" &&
      request.headers.get("authorization") === `Bearer ${bearer}` &&
      (response.status === 401 || response.status === 403)
    )
      count++;
    return response;
  }) as typeof fetch;
  return {
    select(value: string) {
      bearer = value;
      count = 0;
    },
    count: () => count,
    restore() {
      bearer = "";
      count = 0;
      globalThis.fetch = originalFetch;
    },
  };
};

const assertPublicDenied = async (
  stack: string,
  options: { accountId: string; apiToken: string; stateScriptName: string },
  value: string,
  observer: ReturnType<typeof observePermissionDenials>,
) => {
  observer.select(value);
  const result = await Effect.runPromise(
    listEnvironments(stack, {
      cloudflare: { ...options, apiToken: value },
    }).pipe(
      Effect.match({
        onSuccess: () => "unexpected success",
        onFailure: (error) => error.message,
      }),
    ),
  );
  expect(result).toBe(
    "Environment state is unavailable. Check account credentials and state service.",
  );
  expect(observer.count()).toBeGreaterThan(0);
};

// Public equivalent of the adapter authorization suite; values remain in memory.
it("rejects restricted credentials as state bearers and through installed public state discovery", async () => {
  const observer = observePermissionDenials();
  try {
    const authorized = scope();
    const scriptName = `${authorized.prefix}-state-v2`;
    const stack = `${authorized.prefix}-authorization`;
    const options = {
      accountId: authorized.accountId,
      apiToken: authorized.apiToken,
      stateScriptName: scriptName,
    };
    // A working authorized read rules out a missing backend or broken installed bootstrap asset.
    expect(
      Array.isArray(await Effect.runPromise(listEnvironments(stack, { cloudflare: options }))),
    ).toBe(true);
    const subdomainResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${authorized.accountId}/workers/subdomain`,
      {
        headers: { authorization: `Bearer ${authorized.apiToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    expect(subdomainResponse.status).toBe(200);
    const subdomainBody = (await subdomainResponse.json()) as {
      success: boolean;
      result: { subdomain: string };
    };
    expect(subdomainBody.success).toBe(true);
    const subdomain = subdomainBody.result.subdomain;
    expect(subdomain).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    const endpoint = `https://${scriptName}.${subdomain}.workers.dev`;
    for (const permissionId of [
      "c1fde68c7bcc44588cbb6ddbc16d6480", // Account Settings Read
      "1a71c399035b4950a1bd1466bbe4f420", // Workers Scripts Read
    ]) {
      const { id, value } = await createToken(authorized, permissionId);
      try {
        await assertTokenActive(
          authorized.accountId,
          value,
          permissionId === "1a71c399035b4950a1bd1466bbe4f420",
        );
        const denied = await fetch(`${endpoint}/v1/list`, {
          method: "POST",
          headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
          body: JSON.stringify({ stack }),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        expect(denied.status).toBe(401);
        await assertPublicDenied(stack, options, value, observer);
      } finally {
        const removed = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${authorized.accountId}/tokens/${id}`,
          {
            method: "DELETE",
            headers: { authorization: `Bearer ${authorized.managementToken}` },
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          },
        );
        expect(removed.ok, `Temporary test token cleanup failed: ${id}`).toBe(true);
        const result = (await removed.json()) as { success?: boolean };
        expect(result.success).toBe(true);
      }
    }
  } finally {
    observer.restore();
  }
}, 180000);
