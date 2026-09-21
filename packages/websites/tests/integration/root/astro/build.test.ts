import { mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { readBuildResult } from "@renkin/runtime/services/bundler/read-build-result";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { Effect } from "effect";
import { buildAstro } from "../../../../src/contexts/root/services/astro/build-astro.ts";

it.effect(
  "generates actual static routes in workerd and serves the resulting assets",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-build-"));
      let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
      try {
        const build = await buildAstro(
          {
            root: fileURLToPath(new URL("../../../support/root/astro/static/", import.meta.url)),
            output: "static",
            compatibilityDate: "2026-07-30",
            configFile: false,
            config: { outDir: resolve(directory, "assets"), logLevel: "silent" },
          },
          { directory },
        );
        const captured = await readBuildResult(build);
        expect(captured.assets?.files["/index.html"]).toBeDefined();
        expect(
          await readFile(resolve(build.assets?.directory ?? "", "index.html"), "utf8"),
        ).toContain('data-runtime="function"');
        expect(captured.source).not.toContain("SESSION");
        graph = await startLocalGraph({
          workers: [{ id: "static", build, compatibilityDate: "2026-07-30" }],
          namespaces: {},
          persist: resolve(directory, "data"),
          watch: false,
        });
        const response = await graph.workers.static?.fetch("/about/");
        expect(response?.status).toBe(200);
        expect(await response?.text()).toContain("Second static route");
        expect((await graph.workers.static?.fetch("/missing"))?.status).toBe(404);
      } finally {
        await graph?.close();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);

it.effect(
  "loads the real SSR module graph while production prerender has no resource bindings",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-ssr-"));
      let sourceMapHookCalls = 0;
      let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
      try {
        const build = await buildAstro(
          {
            root: fileURLToPath(new URL("../../../support/root/astro/server/", import.meta.url)),
            output: "server",
            compatibilityDate: "2026-07-30",
            configFile: false,
            config: {
              outDir: resolve(directory, "dist"),
              logLevel: "silent",
              vite: {
                build: { sourcemap: true },
                plugins: [
                  {
                    name: "source-map-hook",
                    writeBundle: () => {
                      sourceMapHookCalls++;
                    },
                  },
                ],
              },
            },
          },
          { directory },
        );
        expect(build.modules?.length).toBeGreaterThan(1);
        expect(sourceMapHookCalls).toBeGreaterThan(0);
        expect(
          (await readdir(resolve(directory, "dist/server"), { recursive: true })).some((file) =>
            file.endsWith(".map"),
          ),
        ).toBe(true);
        expect(build.modules?.some((module) => module.path.endsWith(".map"))).toBe(false);
        graph = await startLocalGraph({
          workers: [{ id: "ssr", build, compatibilityDate: "2026-07-30" }],
          namespaces: {},
          persist: resolve(directory, "data"),
          watch: false,
        });
        const response = await graph.workers.ssr?.fetch("/?name=Renkin");
        expect(response?.status).toBe(200);
        expect(await response?.text()).toContain("Hello Renkin");
        const generated = await graph.workers.ssr?.fetch("/generated/");
        expect(generated?.status).toBe(200);
        const page = await generated?.text();
        expect(page).toContain('data-runtime="function"');
        expect(page).toContain('data-binding="undefined"');
      } finally {
        await graph?.close();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);

it.effect(
  "preserves a base path, routing and explicit Node page-generation fallback",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-base-"));
      let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
      try {
        const build = await buildAstro(
          {
            root: fileURLToPath(new URL("../../../support/root/astro/static/", import.meta.url)),
            output: "static",
            compatibilityDate: "2026-07-30",
            configFile: false,
            prerenderEnvironment: "node",
            config: {
              outDir: resolve(directory, "dist"),
              base: "/docs",
              site: "https://example.test",
              trailingSlash: "always",
              logLevel: "silent",
            },
          },
          { directory },
        );
        const captured = await readBuildResult(build);
        expect(captured.assets?.files["/docs/index.html"]).toBeDefined();
        expect(
          Object.keys(captured.assets?.files ?? {}).some((path) => path.endsWith("wrangler.json")),
        ).toBe(false);
        graph = await startLocalGraph({
          workers: [{ id: "static", build, compatibilityDate: "2026-07-30" }],
          namespaces: {},
          persist: resolve(directory, "data"),
          watch: false,
        });
        const response = await graph.workers.static?.fetch("/docs/");
        expect(response?.status).toBe(200);
        expect(await response?.text()).toContain('data-runtime="undefined"');
      } finally {
        await graph?.close();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);

it.effect(
  "builds concurrent static and SSR projects through symlinked roots without sharing compiler state",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-astro-concurrent-"));
      try {
        for (const project of ["static", "server"])
          await symlink(
            fileURLToPath(new URL(`../../../support/root/astro/${project}/`, import.meta.url)),
            resolve(directory, project),
            "dir",
          );
        const results = await Promise.all(
          ["static", "server"].map((project) =>
            buildAstro(
              {
                root: resolve(directory, project),
                output: project === "static" ? "static" : "server",
                compatibilityDate: "2026-07-30",
                configFile: false,
                config: {
                  outDir: resolve(directory, `${project}-dist`),
                  logLevel: "silent",
                  build: { inlineStylesheets: "never" },
                },
              },
              { directory },
            ),
          ),
        );
        for (const result of results) {
          const captured = await readBuildResult(result);
          expect(
            Object.keys(captured.assets?.files ?? {}).some((path) => path.endsWith(".css")),
          ).toBe(true);
        }
        expect(
          await readFile(resolve(results[0]?.assets?.directory ?? "", "index.html"), "utf8"),
        ).toContain("Static Astro");
        expect(results[1]?.modules?.length).toBeGreaterThan(1);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
  90_000,
);
