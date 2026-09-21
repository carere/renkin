import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, development } from "renkin";
import { buildAstro } from "renkin/astro";
import { worker } from "renkin/cloudflare";
import { site } from "../../../renkin.ts";

it.effect(
  "builds and serves the public static example without session storage",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-static-example-"));
      try {
        const build = await buildAstro(site);
        const { builder: _builder, ...options } = site.options;
        expect(site.sessionKV).toBeUndefined();
        expect(site.dependencies).toEqual([]);
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const local = yield* development(
                defineStack({
                  name: "static-example",
                  resources: [worker(site.id, { ...options, build })],
                }),
                { directory, watch: false },
              );
              const running = local.workers.static;
              if (!running) throw new Error("Static example is missing.");
              const home = yield* Effect.promise(() => running.fetch("/"));
              expect(home.status).toBe(200);
              expect(home.headers.get("x-renkin-example")).toBe("astro-static");
              expect(yield* Effect.promise(() => home.text())).toContain('data-runtime="function"');
              const about = yield* Effect.promise(() => running.fetch("/about/"));
              expect(about.status).toBe(200);
              expect(yield* Effect.promise(() => about.text())).toContain(
                "Static, with no session namespace.",
              );
              expect((yield* Effect.promise(() => running.fetch("/missing"))).status).toBe(404);
            }),
          ),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);
