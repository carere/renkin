import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { KVNamespace } from "@cloudflare/workers-types";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { chromium } from "playwright";
import type { WorkerBuildResult } from "renkin";
import { defineStack, development } from "renkin";
import { worker } from "renkin/cloudflare";
import { site } from "#test-fixtures/astro-ssr/renkin.ts";

const buildSite = async (directory: string): Promise<WorkerBuildResult> => {
  await promisify(execFile)(
    process.versions.bun ? process.execPath : "bun",
    ["--no-env-file", "--bun", "astro", "build"],
    {
      cwd: site.astro.root,
      env: {
        ...process.env,
        WRANGLER_REGISTRY_PATH: resolve(directory, "registry"),
        MINIFLARE_REGISTRY_PATH: resolve(directory, "miniflare"),
        WRANGLER_LOG_PATH: resolve(directory, "wrangler.log"),
      },
      timeout: 60_000,
      maxBuffer: 300_000,
    },
  );
  return JSON.parse(await readFile(resolve(site.astro.root, ".renkin/build-result.json"), "utf8"));
};

it.effect(
  "runs the built SSR website with native bindings, sessions and workerd page generation",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-website-example-"));
      const browser = await chromium.launch({ headless: true });
      try {
        const build = await buildSite(directory);
        const { builder: _builder, ...options } = site.options;
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const local = yield* development(
                defineStack({
                  name: "website-example",
                  resources: [worker(site.id, { ...options, build })],
                }),
                { directory, watch: false },
              );
              const running = local.workers.website;
              if (!running) throw new Error("SSR example is missing.");
              const bindings = yield* Effect.promise(() => local.bindings("website"));
              yield* Effect.promise(() =>
                (bindings.CONTENT as KVNamespace).put(
                  "welcome",
                  "Native data from the shared resource graph.",
                ),
              );
              const content = yield* Effect.promise(() => running.fetch("/api/content"));
              expect(content.status).toBe(200);
              expect(yield* Effect.promise(() => content.json())).toEqual({
                message: "Native data from the shared resource graph.",
              });
              yield* Effect.promise(async () => {
                const page = await browser.newPage();
                const errors: string[] = [];
                page.on("pageerror", (error) => errors.push(error.message));
                await page.goto(new URL("/?name=Browser", running.url).href);
                await page.getByRole("heading", { name: "Hello, Browser." }).waitFor();
                await page.getByRole("link", { name: "Session counter" }).click();
                await page.locator('[data-count="1"]').waitFor();
                await page.getByRole("link", { name: "Visit again" }).click();
                await page.locator('[data-count="2"]').waitFor();
                expect(errors).toEqual([]);
                await page.close();
              });
              const home = yield* Effect.promise(() => running.fetch("/?name=Astro"));
              expect(yield* Effect.promise(() => home.text())).toContain("Hello, Astro.");
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
              const generated = yield* Effect.promise(() => running.fetch("/generated"));
              expect(generated.status).toBe(200);
              const body = yield* Effect.promise(() => generated.text());
              expect(body).toContain('data-runtime="function"');
              expect(body).toContain('data-content="undefined"');
            }),
          ),
        );
      } finally {
        await browser.close();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);
