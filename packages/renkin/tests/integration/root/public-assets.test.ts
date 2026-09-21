import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, development, type WorkerBuildResult } from "renkin";
import { worker } from "renkin/cloudflare";

it.live(
  "runs an external build through public development with assets, routing and reload",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-public-assets-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      );
      yield* Effect.promise(async () => {
        await mkdir(join(directory, "assets"));
        await writeFile(
          join(directory, "entry.mjs"),
          "export default {fetch:()=>new Response('api')}",
        );
        await writeFile(join(directory, "assets/index.html"), "<h1>external-one</h1>");
        await writeFile(join(directory, "assets/_headers"), "/*\n  X-External-Build: yes\n");
        await writeFile(join(directory, "assets/_redirects"), "/old /new 302\n");
      });
      const build: WorkerBuildResult = {
        entry: join(directory, "entry.mjs"),
        assets: {
          directory: join(directory, "assets"),
          config: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*"] },
        },
        compatibilityDate: "2026-07-30",
      };
      const session = yield* development(
        defineStack({
          name: "external",
          resources: [worker("site", { build, compatibilityDate: "2026-07-30" })],
        }),
        { directory: join(directory, "state"), watch: false },
      );
      const site = session.workers.site;
      if (!site) throw new Error("Missing site Worker");
      const response = yield* Effect.promise(() => site.fetch());
      expect(yield* Effect.promise(() => response.text())).toContain("external-one");
      expect(response.headers.get("x-external-build")).toBe("yes");
      expect((yield* Effect.promise(() => site.fetch("/old", { redirect: "manual" }))).status).toBe(
        302,
      );
      expect(yield* Effect.promise(async () => (await site.fetch("/api/health")).text())).toBe(
        "api",
      );
      expect(
        yield* Effect.promise(async () =>
          (await site.fetch("/nested", { headers: { "Sec-Fetch-Mode": "navigate" } })).text(),
        ),
      ).toContain("external-one");
      yield* Effect.promise(async () => {
        await writeFile(join(directory, "assets/index.html"), "<h1>external-two</h1>");
        await site.reload();
      });
      expect(yield* Effect.promise(async () => (await site.fetch()).text())).toContain(
        "external-two",
      );
    }).pipe(Effect.scoped),
  30_000,
);
