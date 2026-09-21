import { randomUUID } from "node:crypto";
import type { StateLease } from "@renkin/core/services/state/state-repository";
import { expect, it } from "vitest";
import { ensureCloudflareState } from "#src/contexts/root/services/state/bootstrap-cloudflare-state.ts";
import { CloudflareStateRepository } from "#src/contexts/root/services/state/cloudflare-state-repository.ts";

type Provider = (path: string, method?: string) => Promise<Response>;
const removeBackend = async (provider: Provider, scriptName: string): Promise<void> => {
  const settingsResponse = await provider(`/workers/scripts/${scriptName}/settings`);
  if (settingsResponse.status !== 404) {
    if (!settingsResponse.ok)
      throw new Error(`Temporary backend inspection failed (${settingsResponse.status}).`);
    const settings = (await settingsResponse.json()) as { result?: { tags?: string[] } };
    if (!settings.result?.tags?.includes("renkin-state-v2"))
      throw new Error("Temporary backend ownership could not be verified.");
    // Exact generated backend contains synthetic data only, including after a failed write.
    const removed = await provider(`/workers/scripts/${scriptName}?force=true`, "DELETE");
    if (!removed.ok) throw new Error(`Temporary backend removal failed (${removed.status}).`);
    await removed.text();
  }
  expect((await provider(`/workers/scripts/${scriptName}/settings`)).status).toBe(404);
  const namespacesResponse = await provider("/workers/durable_objects/namespaces");
  if (!namespacesResponse.ok)
    throw new Error(`Namespace cleanup inspection failed (${namespacesResponse.status}).`);
  const namespaces = (await namespacesResponse.json()) as {
    result?: { script?: string }[];
  };
  expect(namespaces.result?.some((entry) => entry.script === scriptName)).toBe(false);
  console.info({ statePressureBackend: scriptName, cleanupVerified: true });
};

// Local workerd does not reproduce the provider's memory/admission behavior.
// This regression owns only synthetic state in a disposable backend, never application resources.
it.skipIf(process.env.RENKIN_CLOUDFLARE_STATE_PRESSURE_TESTS !== "true")(
  "repeats twenty 20 MiB encrypted checkpoints without blocking the coordinator",
  async () => {
    const env = process.env;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    const prefix = env.RENKIN_CLOUDFLARE_TEST_PREFIX;
    const expiry = Date.parse(env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "");
    if (
      env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
      !accountId ||
      !apiToken ||
      !prefix ||
      !Number.isFinite(expiry) ||
      Date.now() >= expiry
    )
      throw new Error("State pressure validation requires current temporary-resource scope.");

    const scriptName = `${prefix}-state-pressure-${randomUUID().slice(0, 8)}`;
    const stack = `${prefix}-state-pressure`;
    const environment = "repeated";
    console.info({ statePressureBackend: scriptName });
    const transport: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      return fetch(request, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      });
    };
    const provider = (path: string, method = "GET") =>
      transport(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
        method,
        headers: { authorization: `Bearer ${apiToken}` },
        redirect: "error",
      });
    let lease: StateLease | undefined;
    try {
      const state = await ensureCloudflareState({
        accountId,
        apiToken,
        stateScriptName: scriptName,
      });
      const repository = new CloudflareStateRepository({ ...state, apiToken, fetch: transport });
      lease = await repository.acquire(stack, environment);
      const payload = "x".repeat(20 * 1024 * 1024);
      for (let iteration = 0; iteration < 20; iteration++) {
        await lease.write({
          version: 1,
          stack,
          environment,
          resources: {},
          outputs: {
            payload: { value: payload, secret: true },
            iteration: { value: iteration, secret: false },
          },
        });
        const observed = await lease.read();
        expect(observed?.outputs.payload?.value === payload).toBe(true);
        expect(observed?.outputs.iteration?.value).toBe(iteration);
        expect((await repository.inspect(stack, environment)).leaseActive).toBe(true);
      }
      await lease.write({ version: 1, stack, environment, resources: {}, outputs: {} });
      await lease.removeEmpty();
      expect(await repository.read(stack, environment)).toBeUndefined();
      expect(await repository.list(stack)).not.toContain(environment);
    } finally {
      try {
        await lease?.release();
      } finally {
        await removeBackend(provider, scriptName);
      }
    }
  },
  300_000,
);
