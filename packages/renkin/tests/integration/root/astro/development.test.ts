import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, development } from "renkin";
import { astro, kv } from "renkin/cloudflare";
import { afterAll, beforeAll, vi } from "vitest";

// Astro intentionally omits its HTTP middleware when VITEST is set. Exercise the real server.
beforeAll(() => vi.stubEnv("VITEST", undefined));
afterAll(() => vi.unstubAllEnvs());

const root = fileURLToPath(
  new URL("../../../../../websites/tests/support/root/astro/server/", import.meta.url),
);
const fetchSite = (
  local: Effect.Success<ReturnType<typeof development>>,
  path?: string,
  init?: RequestInit,
) => {
  const site = local.workers.site;
  if (!site) throw new Error("Missing Astro development Worker.");
  return site.fetch(path, { ...init, signal: AbortSignal.timeout(10_000) });
};
const compatibilityDate = "2026-07-30";

it.effect(
  "keeps automatic sessions in native KV across local development restarts",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-session-"));
      const site = astro("site", { root, output: "server", compatibilityDate, configFile: false });
      const stack = defineStack({ name: "session", resources: [site] });
      let cookie = "";
      try {
        expect(site.sessionKV?.protection).toEqual({ data: true, allowDelete: false });
        for (let count = 1; count <= 2; count++)
          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const local = yield* development(stack, { directory, watch: false });
                const response = yield* Effect.promise(() =>
                  fetchSite(local, "/session", { headers: { cookie } }),
                );
                expect(response.status).toBe(200);
                cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
                expect(yield* Effect.promise(() => response.text())).toContain(
                  `data-count="${count}"`,
                );
                const bindings = yield* Effect.promise(() => local.bindings("site"));
                expect(Object.keys(bindings)).toContain("SESSION");
              }),
            ),
          );
        const disabled = astro("site", {
          root,
          output: "server",
          compatibilityDate,
          configFile: false,
          sessionKVBindingName: false,
        });
        await expect(
          Effect.runPromise(
            Effect.scoped(
              development(defineStack({ name: "session", resources: [disabled] }), {
                directory,
                watch: false,
              }),
            ),
          ),
        ).rejects.toThrow("Deletion protection");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);

it.effect(
  "uses a declared session namespace without creating another and supports disabling sessions",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-variants-"));
      const existing = kv("existing");
      try {
        const site = astro("site", {
          root,
          output: "server",
          compatibilityDate,
          configFile: false,
          sessionKVBindingName: "VISITS",
          bindings: { VISITS: existing },
        });
        expect(site.sessionKV).toBe(existing);
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const local = yield* development(
                defineStack({ name: "existing", resources: [site] }),
                { directory, watch: false },
              );
              const response = yield* Effect.promise(() => fetchSite(local, "/session"));
              expect(response.status).toBe(200);
              expect(
                Object.keys(yield* Effect.promise(() => local.bindings("site"))).filter(
                  (name) => !name.startsWith("__RENKIN_"),
                ),
              ).toEqual(["VISITS"]);
            }),
          ),
        );
        const disabled = astro("site", {
          root,
          output: "server",
          compatibilityDate,
          configFile: false,
          sessionKVBindingName: false,
        });
        expect(disabled.sessionKV).toBeUndefined();
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const local = yield* development(
                defineStack({ name: "disabled", resources: [disabled] }),
                { directory, watch: false },
              );
              expect(
                Object.keys(yield* Effect.promise(() => local.bindings("site"))).filter(
                  (name) => !name.startsWith("__RENKIN_"),
                ),
              ).toEqual([]);
              const response = yield* Effect.promise(() => fetchSite(local, "/?name=Disabled"));
              expect(response.status).toBe(200);
              expect(yield* Effect.promise(() => response.text())).toContain("Hello Disabled");
            }),
          ),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);

it.effect(
  "reloads Astro source using its native development server",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-reload-"));
      const app = resolve(directory, "app");
      await cp(resolve(root, "src"), resolve(app, "src"), { recursive: true });
      await symlink(
        fileURLToPath(new URL("../../../../../websites/node_modules/", import.meta.url)),
        resolve(app, "node_modules"),
        "dir",
      );
      const file = resolve(app, "src/pages/index.astro");
      try {
        const site = astro("site", {
          root: app,
          output: "server",
          compatibilityDate,
          configFile: false,
          sessionKVBindingName: false,
          config: {
            logLevel: "silent",
            vite: { server: { watch: { usePolling: true, interval: 50 } } },
          },
        });
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const local = yield* development(defineStack({ name: "reload", resources: [site] }), {
                directory: resolve(directory, "state"),
                watch: true,
              });
              expect(
                yield* Effect.promise(async () => await (await fetchSite(local)).text()),
              ).toContain("Rendered per request");
              yield* Effect.promise(async () =>
                writeFile(
                  file,
                  (await readFile(file, "utf8")).replace(
                    "Rendered per request",
                    "Reloaded Astro source",
                  ),
                ),
              );
              let reloaded = false;
              for (let attempt = 0; attempt < 100; attempt++) {
                const response = yield* Effect.promise(() => fetchSite(local));
                if (
                  (yield* Effect.promise(() => response.text())).includes("Reloaded Astro source")
                ) {
                  reloaded = true;
                  break;
                }
                yield* Effect.sleep("100 millis");
              }
              expect(reloaded).toBe(true);
            }),
          ),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);
