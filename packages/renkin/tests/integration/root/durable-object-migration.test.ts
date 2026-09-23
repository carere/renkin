import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, development } from "@carere/renkin";
import { durableObject, kv, worker } from "@carere/renkin/cloudflare";
import { applicationFixture } from "@carere/renkin/testing";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect(
  "logical and explicit class renames keep native data while undeclared replacement is blocked",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() =>
          mkdtemp(fileURLToPath(new URL("../../fixtures/do-migration-", import.meta.url))),
        ),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      const source = yield* Effect.promise(() =>
        readFile(new URL("../../fixtures/durable-object/counter.ts", import.meta.url), "utf8"),
      );
      const entry = join(root, "worker.ts");
      yield* Effect.promise(() => writeFile(entry, source));
      const desired = (id: string, className: string, renamedFrom?: string) =>
        defineStack({
          name: "object-migrations",
          resources: [
            durableObject(id, {
              worker: "Api",
              className,
              ...(renamedFrom ? { renamedFrom } : {}),
            }),
            kv("Audit"),
            worker("Api", { entry, compatibilityDate: "2026-07-30" }),
          ],
        });
      let stack = desired("Counters", "Counter");
      const fixture = yield* applicationFixture(() =>
        development(stack, { directory: join(root, "state"), watch: false }),
      );
      const increment = () =>
        Effect.promise(async () => {
          const api = fixture.current.workers.Api;
          if (!api) throw new Error("Missing Worker.");
          const response = await api.fetch("/increment");
          expect(response.status).toBe(200);
          return response.json() as Promise<{ id: string; value: number }>;
        });
      const first = yield* increment();
      yield* Effect.promise(() =>
        writeFile(entry, source.replace('"Counters"', '"RenamedCounters"')),
      );
      stack = {
        ...desired("RenamedCounters", "Counter"),
        renames: [{ from: "Counters", to: "RenamedCounters" }],
      };
      yield* fixture.restart;
      expect(yield* increment()).toEqual({ id: first.id, value: 2 });
      const migrated = source
        .replace('"Counters"', '"RenamedCounters"')
        .replace(/\bCounter\b/g, "NewCounter");
      yield* Effect.promise(() => writeFile(entry, migrated));
      stack = desired("RenamedCounters", "NewCounter");
      expect((yield* Effect.flip(fixture.restart)).message).toContain("Deletion protection");
      stack = desired("RenamedCounters", "NewCounter", "Counter");
      yield* fixture.restart;
      expect(yield* increment()).toEqual({ id: first.id, value: 3 });
    }),
  30000,
);
