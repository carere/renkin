import { build } from "esbuild";
import { type Request as EmulatorRequest, Miniflare, Response } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { RecoveryInspection } from "#src/contexts/root/services/state/reconciliation.ts";

let emulator: Miniflare;
let complete: (() => void) | undefined;
let dispatchStarted: (() => void) | undefined;
let calls = 0;
beforeAll(async () => {
  const bundle = await build({
    entryPoints: [new URL("./recovery-fixture.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  emulator = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]?.text ?? "",
    compatibilityDate: "2026-08-01",
    bindings: { ACCOUNT_ID: "test-account", RENKIN_STATE_AUTH: "state-secret" },
    durableObjects: { STATE_COORDINATOR: { className: "StateCoordinator", useSQLite: true } },
    outboundService: async (request: EmulatorRequest) => {
      calls += 1;
      if (request.url.includes("held"))
        await new Promise<void>((resolve) => {
          complete = resolve;
          dispatchStarted?.();
        });
      return new Response("unknown provider outcome", { status: 503 });
    },
  });
});
afterAll(async () => {
  await emulator.dispose();
});
const call = (action: string, environment: string, input: Record<string, unknown> = {}) =>
  emulator.dispatchFetch(`https://state.test/v1/${action}`, {
    method: "POST",
    headers: {
      authorization: "Bearer state-secret",
      "x-renkin-cloudflare-token": "provider-secret",
    },
    body: JSON.stringify({ stack: "stack", environment, ...input }),
  });
const inspect = async (environment: string) =>
  (await (await call("inspect", environment)).json()) as RecoveryInspection;
const mutation = (path: string) => ({
  method: "POST",
  path: `/accounts/test-account/${path}`,
  bodyBase64: Buffer.from("private request body").toString("base64"),
});
const decision = (operationId: string, outcome: "completed" | "not-applied" = "completed") => ({
  operationId,
  outcome,
  operator: "operator@example.test",
  evidence: "support-case-123",
  providerSettled: true,
});

it.each(["completed", "not-applied"] as const)(
  "records explicit %s settlement, preserves pending state and fences stale callers",
  async (outcome) => {
    const environment = `recover-${outcome}`;
    const lease = (await (await call("acquire", environment)).json()) as { token: string };
    const saved = JSON.stringify({
      pending: { owned: "preserve ownership/checkpoint" },
      secret: "private output",
    });
    await call("write", environment, { token: lease.token, state: saved });
    await call("mutate", environment, { token: lease.token, request: mutation("unknown") });
    const before = await inspect(environment);
    const id = before.operation?.operationId ?? "";
    expect(before.operation?.target).toBe("/client/v4/accounts/test-account/unknown");
    expect(before.coordinatorActive).toBe(false);
    expect((await call("reconcile", environment, { decision: decision(id, outcome) })).status).toBe(
      409,
    );
    await call("test-expire", environment);
    expect((await call("acquire", environment)).status).toBe(409);
    expect(
      (await call("reconcile", environment, { decision: decision(crypto.randomUUID()) })).status,
    ).toBe(409);
    expect(
      (
        await call("reconcile", environment, {
          decision: { ...decision(id), providerSettled: false },
        })
      ).status,
    ).toBe(400);
    expect((await call("reconcile", environment, { decision: decision(id, outcome) })).status).toBe(
      200,
    );
    expect((await call("reconcile", environment, { decision: decision(id, outcome) })).status).toBe(
      409,
    );
    const after = await inspect(environment);
    expect(after.operation).toBeNull();
    expect(after.audit).toMatchObject([
      {
        operationId: id,
        outcome,
        operator: "operator@example.test",
        evidence: "support-case-123",
        epoch: 2,
      },
    ]);
    expect(await (await call("read", environment)).json()).toBe(saved);
    const raw = await (await call("test-raw", environment)).text();
    expect(raw).not.toContain("support-case-123");
    expect(raw).not.toContain("private output");
    expect(JSON.stringify(after)).not.toMatch(/private request body|provider-secret|state-secret/);
    expect((await call("write", environment, { token: lease.token, state: "stale" })).status).toBe(
      409,
    );
    expect(
      (await call("mutate", environment, { token: lease.token, request: mutation("unknown") }))
        .status,
    ).toBe(409);
    expect((await call("acquire", environment)).status).toBe(200);
  },
);

it("refuses reconciliation and overlapping dispatch while an expired lease still has an active fetch", async () => {
  const environment = "held-dispatch";
  const lease = (await (await call("acquire", environment)).json()) as { token: string };
  const started = new Promise<void>((resolve) => {
    dispatchStarted = resolve;
  });
  const inFlight = call("mutate", environment, { token: lease.token, request: mutation("held") });
  await started;
  try {
    await call("test-expire", environment);
    const state = await inspect(environment);
    const id = state.operation?.operationId ?? "";
    const count = calls;
    expect(state.coordinatorActive).toBe(true);
    expect(state.leaseActive).toBe(false);
    expect((await call("reconcile", environment, { decision: decision(id) })).status).toBe(409);
    expect((await call("acquire", environment)).status).toBe(409);
    expect(calls).toBe(count);
    complete?.();
    await inFlight;
    expect((await inspect(environment)).coordinatorActive).toBe(false);
    expect((await call("reconcile", environment, { decision: decision(id) })).status).toBe(200);
  } finally {
    complete?.();
    await inFlight;
  }
});
