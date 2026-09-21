import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { startLocalBuild } from "../../../../../src/contexts/root/services/local/local-build-service.ts";

describe("external Worker build and native assets", () => {
  it.live(
    "serves static HTML, SPA fallback, Worker-first API routes and reloads a build",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-assets-"))),
          (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        yield* Effect.promise(async () => {
          await mkdir(join(directory, "public"));
          await writeFile(
            join(directory, "worker.mjs"),
            "export default {fetch:()=>new Response('api-one')}",
          );
          await writeFile(join(directory, "public/index.html"), "<h1>site-one</h1>");
          await writeFile(join(directory, "public/about.html"), "<h1>about</h1>");
        });
        const worker = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startLocalBuild({
              entry: join(directory, "worker.mjs"),
              assets: {
                directory: join(directory, "public"),
                config: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*"] },
              },
            }),
          ),
          (worker) => Effect.promise(() => worker.close()),
        );
        expect(yield* Effect.promise(async () => (await worker.fetch("/")).text())).toContain(
          "site-one",
        );
        expect(
          yield* Effect.promise(async () =>
            (await worker.fetch("/route", { headers: { "Sec-Fetch-Mode": "navigate" } })).text(),
          ),
        ).toContain("site-one");
        expect(yield* Effect.promise(async () => (await worker.fetch("/about")).text())).toContain(
          "about",
        );
        expect(yield* Effect.promise(async () => (await worker.fetch("/api/health")).text())).toBe(
          "api-one",
        );
        yield* Effect.promise(async () => {
          await writeFile(
            join(directory, "worker.mjs"),
            "export default {fetch:()=>new Response('api-two')}",
          );
          await worker.reload();
        });
        expect(yield* Effect.promise(async () => (await worker.fetch("/api/health")).text())).toBe(
          "api-two",
        );
      }).pipe(Effect.scoped),
    30_000,
  );
});
