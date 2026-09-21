import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
      try {
        const build = await buildAstro(
          {
            root: fileURLToPath(new URL("../../../support/root/astro/server/", import.meta.url)),
            output: "server",
            compatibilityDate: "2026-07-30",
            configFile: false,
            config: { outDir: resolve(directory, "dist"), logLevel: "silent" },
          },
          { directory },
        );
        expect(build.modules?.length).toBeGreaterThan(1);
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
