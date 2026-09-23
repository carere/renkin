import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, development } from "@carere/renkin";
import { buildAstro } from "@carere/renkin/astro";
import { astro, kv, worker } from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect(
  "builds public artifacts with an existing session KV or sessions disabled, overriding file drivers",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-built-sessions-"));
      const root = fileURLToPath(
        new URL("../../../../../websites/tests/support/root/astro/server/", import.meta.url),
      );
      const configFile = resolve(directory, "astro.config.mjs");
      await writeFile(configFile, "export default {session:false};\n");
      try {
        for (const enabled of [true, false]) {
          const site = astro("site", {
            root,
            output: "server",
            compatibilityDate: "2026-07-30",
            configFile,
            sessionKVBindingName: enabled ? "VISITS" : false,
            bindings: enabled ? { VISITS: kv("visits") } : {},
            config: { outDir: resolve(directory, enabled ? "enabled" : "disabled") },
          });
          const build = await buildAstro(site);
          const { builder: _builder, ...options } = site.options;
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const local = yield* development(
                  defineStack({
                    name: enabled ? "enabled" : "disabled",
                    resources: [worker("site", { ...options, build })],
                  }),
                  { directory: resolve(directory, "state"), watch: false },
                );
                const running = local.workers.site;
                if (!running) throw new Error("Built Astro site missing.");
                const status = yield* Effect.promise(() => running.fetch("/session-status"));
                expect(yield* Effect.promise(() => status.json())).toEqual({ enabled });
                if (enabled) {
                  let cookie = "";
                  for (let count = 1; count <= 2; count++) {
                    const response = yield* Effect.promise(() =>
                      running.fetch("/session", { headers: { cookie } }),
                    );
                    expect(response.status).toBe(200);
                    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
                    expect(yield* Effect.promise(() => response.text())).toContain(
                      `data-count="${count}"`,
                    );
                  }
                }
              }),
            ),
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
  90_000,
);
