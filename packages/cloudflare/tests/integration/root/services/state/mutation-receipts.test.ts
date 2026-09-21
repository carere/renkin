import { afterAll, beforeAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { build } from "esbuild";
import { Miniflare, Response } from "miniflare";

let emulator: Miniflare;
let dispatches = 0;
beforeAll(async () => {
  const script = await build({
    entryPoints: [new URL("./recovery-fixture.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  emulator = new Miniflare({
    modules: true,
    script: script.outputFiles[0]?.text ?? "",
    compatibilityDate: "2026-08-01",
    bindings: { ACCOUNT_ID: "account", RENKIN_STATE_AUTH: "state-secret" },
    durableObjects: { STATE_COORDINATOR: { className: "StateCoordinator", useSQLite: true } },
    outboundService: async () => {
      dispatches++;
      return Response.json({
        success: true,
        result: {
          id: "provider-id",
          client_id: "client-id",
          client_secret: "one-time-secret",
          name: "test-allocation",
        },
      });
    },
  });
});
afterAll(() => emulator.dispose());
const call = (action: string, environment: string, input: Record<string, unknown> = {}) =>
  emulator.dispatchFetch(`https://state.test/v1/${action}`, {
    method: "POST",
    headers: {
      authorization: "Bearer state-secret",
      "x-renkin-cloudflare-token": "provider-secret",
    },
    body: JSON.stringify({ stack: "stack", environment, ...input }),
  });
const definition = {
  id: "token",
  type: "cloudflare.access-service-token",
  identity: "token",
  properties: { name: "test" },
};
const pending = {
  change: { id: "token", kind: "create", desired: definition },
  physicalId: "allocation",
  phase: "apply",
};
const state = {
  version: 1,
  stack: "stack",
  environment: "receipt",
  resources: {},
  outputs: {},
  pending,
};
const mutation = {
  method: "POST",
  path: "/accounts/account/access/service_tokens",
  bodyBase64: Buffer.from(JSON.stringify({ name: "test-allocation" })).toString("base64"),
  operationKey: "access-token-create:allocation",
};
const acquire = async (environment: string) =>
  (await (await call("acquire", environment)).json()) as { token: string };
const gateway = async (
  environment: string,
  token: string,
  request: Record<string, unknown> = mutation,
) => await call("mutate", environment, { token, request });

it.live(
  "replays the encrypted one-time response after lease loss and acknowledges only its checkpoint",
  () =>
    Effect.promise(async () => {
      const before = dispatches;
      const first = await acquire("receipt");
      await call("write", "receipt", { token: first.token, state: JSON.stringify(state) });
      const missing = await (
        await gateway("receipt", first.token, { ...mutation, receiptOnly: true })
      ).json();
      expect(JSON.stringify(missing)).not.toContain("one-time-secret");
      expect(dispatches).toBe(before);
      const created = await (await gateway("receipt", first.token)).json();
      await call("test-expire", "receipt");
      const second = await acquire("receipt");
      expect(
        await (await gateway("receipt", second.token, { ...mutation, receiptOnly: true })).json(),
      ).toEqual(created);
      expect(dispatches).toBe(before + 1);
      expect(
        (
          await gateway("receipt", second.token, {
            ...mutation,
            bodyBase64: Buffer.from(JSON.stringify({ name: "different" })).toString("base64"),
          })
        ).status,
      ).toBe(409);
      const raw = await (await call("test-raw", "receipt")).text();
      expect(raw).not.toMatch(/one-time-secret|client-id/);
      const applied = {
        definition,
        physicalId: "provider-id",
        outputs: {
          id: "provider-id",
          clientId: "client-id",
          clientSecret: "wrong",
          creationReceipt: mutation.operationKey,
        },
      };
      await call("write", "receipt", {
        token: second.token,
        state: JSON.stringify({ ...state, pending: { ...pending, applied } }),
      });
      expect(
        await (await gateway("receipt", second.token, { ...mutation, receiptOnly: true })).json(),
      ).toEqual(created);
      applied.outputs.clientSecret = "one-time-secret";
      const committed = { ...state, pending: { ...pending, applied } };
      expect(
        (await call("write", "receipt", { token: second.token, state: JSON.stringify(committed) }))
          .status,
      ).toBe(200);
      expect(
        await (await gateway("receipt", second.token, { ...mutation, receiptOnly: true })).json(),
      ).not.toEqual(created);
      expect(await (await call("read", "receipt")).json()).toBe(JSON.stringify(committed));
      expect(dispatches).toBe(before + 1);
    }),
);

it.live("requires persisted exact allocation intent and keeps a new allocation independent", () =>
  Effect.promise(async () => {
    const before = dispatches;
    const lease = await acquire("another");
    expect((await gateway("another", lease.token)).status).toBe(502);
    expect(dispatches).toBe(before);
    await call("write", "another", {
      token: lease.token,
      state: JSON.stringify({
        ...state,
        environment: "another",
        pending: { ...pending, physicalId: "new-allocation" },
      }),
    });
    expect(
      (
        await gateway("another", lease.token, {
          ...mutation,
          operationKey: "access-token-create:new-allocation",
        })
      ).status,
    ).toBe(200);
    expect(dispatches).toBe(before + 1);
  }),
);
