import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const fixture = async (directory: string) => {
  const bundle = await build({
    entryPoints: [new URL("./recovery-fixture.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  return new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]?.text ?? "",
    compatibilityDate: "2026-08-01",
    bindings: { ACCOUNT_ID: "account", RENKIN_STATE_AUTH: "state-secret" },
    durableObjects: { STATE_COORDINATOR: { className: "StateCoordinator", useSQLite: true } },
    durableObjectsPersist: directory,
  });
};
const call = (
  emulator: Miniflare,
  action: string,
  environment: string,
  input: Record<string, unknown> = {},
) =>
  emulator.dispatchFetch(`https://state.test/v1/${action}`, {
    method: "POST",
    headers: {
      authorization: "Bearer state-secret",
      "x-renkin-cloudflare-token": "provider-secret",
    },
    body: JSON.stringify({ stack: "stack", environment, ...input }),
  });

it.live(
  "persists ciphertext beyond the SQLite row limit across restart and rejects missing chunks",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "renkin-chunked-state-"));
      let emulator = await fixture(directory);
      try {
        const lease = (await (await call(emulator, "acquire", "large")).json()) as {
          token: string;
        };
        const state = JSON.stringify({ source: `unique-secret-${"a".repeat(10 * 1024 * 1024)}` });
        expect((await call(emulator, "write", "large", { token: lease.token, state })).status).toBe(
          200,
        );
        expect(await (await call(emulator, "read", "large")).json()).toBe(state);
        const small = JSON.stringify({ source: "small" });
        expect(
          (await call(emulator, "write", "large", { token: lease.token, state: small })).status,
        ).toBe(200);
        expect(await (await call(emulator, "read", "large")).json()).toBe(small);
        await call(emulator, "write", "large", { token: lease.token, state });
        await emulator.dispose();
        emulator = await fixture(directory);
        expect(await (await call(emulator, "read", "large")).json()).toBe(state);
        const raw = await (await call(emulator, "test-raw", "large")).text();
        expect(raw).not.toContain("unique-secret");
        expect(raw.length).toBeLessThan(2000);
        await call(emulator, "test-damage-chunk", "large");
        expect((await call(emulator, "read", "large")).status).toBe(502);
        expect(await (await call(emulator, "read", "missing")).json()).toBeNull();
      } finally {
        await emulator.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  90_000,
);

it.live(
  "reads legacy single-row ciphertext and replaces it with an atomic chunked checkpoint",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "renkin-legacy-state-"));
      const emulator = await fixture(directory);
      try {
        const lease = (await (await call(emulator, "acquire", "legacy")).json()) as {
          token: string;
        };
        await call(emulator, "write", "legacy", { token: lease.token, state: '{"secret":"old"}' });
        await call(emulator, "test-legacy-state", "legacy");
        expect(await (await call(emulator, "read", "legacy")).json()).toBe('{"secret":"old"}');
        await call(emulator, "write", "legacy", { token: lease.token, state: '{"secret":"new"}' });
        expect(await (await call(emulator, "read", "legacy")).json()).toBe('{"secret":"new"}');
      } finally {
        await emulator.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }),
);
