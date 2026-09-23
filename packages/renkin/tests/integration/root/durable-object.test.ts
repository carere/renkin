import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, development } from "@carere/renkin";
import { durableObject, kv, worker } from "@carere/renkin/cloudflare";
import { applicationFixture } from "@carere/renkin/testing";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

const entry = fileURLToPath(new URL("../../fixtures/durable-object/counter.ts", import.meta.url));

it.effect(
  "native Durable Object identity, SQLite, KV storage and alarm survive application restart",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-do-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      let stack = defineStack({
        name: "durable-public",
        resources: [
          durableObject("Counters", { worker: "Api", className: "Counter" }),
          kv("Audit"),
          worker("Api", { entry, compatibilityDate: "2026-07-30" }),
        ],
      });
      const fixture = yield* applicationFixture(() =>
        development(stack, { directory, watch: false }),
      );
      const request = (path: string) =>
        Effect.promise(async () => {
          const api = fixture.current.workers.Api;
          if (!api) throw new Error("Missing fixture Worker.");
          const response = await api.fetch(path);
          expect(response.status).toBe(200);
          return response.json() as Promise<{
            id: string;
            value?: number;
            last?: number;
            alarm?: number;
          }>;
        });
      const initial = yield* request("/increment");
      expect(initial.value).toBe(1);
      yield* request("/schedule");
      yield* fixture.restart;
      const second = yield* request("/increment");
      expect(second).toEqual({ id: initial.id, value: 2 });
      yield* Effect.promise(async () => {
        await expect
          .poll(async () => (await Effect.runPromise(request("/"))).alarm, { timeout: 8000 })
          .toBe(1);
      });
      expect((yield* request("/")).last).toBe(2);
      yield* fixture.restart;
      expect(yield* request("/")).toEqual({ id: initial.id, last: 2, alarm: 1 });
      const previous = stack;
      stack = defineStack({ name: stack.name, resources: [] });
      const failure = yield* Effect.flip(fixture.restart);
      expect(failure.message).toContain("Deletion protection");
      expect(() => fixture.current).toThrow("not running");
      stack = previous;
      yield* fixture.restart;
      expect(yield* request("/")).toEqual({ id: initial.id, last: 2, alarm: 1 });
    }),
  30000,
);
