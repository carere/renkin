import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Stack } from "#src/contexts/root/models/stack.ts";
import type { ResourceServices } from "#src/contexts/root/services/resource/resource-service.ts";
import { FileStateRepository } from "#src/contexts/root/services/state/file-state-repository.ts";
import type { StateRepository } from "#src/contexts/root/services/state/state-repository.ts";
import { deploy } from "#src/contexts/root/use-cases/deploy.ts";

const resourceServices =
  (counts: { applies: number; observations: number }): ResourceServices =>
  () => ({
    object: {
      deferredBindings: true,
      apply: (definition) =>
        Effect.sync(() => {
          if (definition.id === "Object") counts.applies++;
          return { owner: "worker" };
        }),
      bind: (resource) =>
        Effect.sync(() => {
          if (resource.definition.id === "Legacy") return;
          counts.observations++;
          return {
            owner: "worker",
            namespaceId: "provider-namespace",
          };
        }),
      remove: () => Effect.sync(() => {}),
    },
  });

it.effect(
  "binding outputs checkpoint atomically and recover after a lost write; void keeps apply outputs",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "renkin-binding-outputs-"));
      const disk = new FileStateRepository(directory);
      let loseCheckpoint = true;
      const counts = { applies: 0, observations: 0 };
      const state: StateRepository = {
        read: (stack, env) => disk.read(stack, env),
        list: (stack) => disk.list(stack),
        acquire: (stack, env) =>
          Effect.gen(function* () {
            const lease = yield* disk.acquire(stack, env);
            return {
              ...lease,
              write: (snapshot) =>
                loseCheckpoint &&
                snapshot.pending?.change.id === "Object" &&
                snapshot.pending.phase === "remove-previous"
                  ? Effect.die(new Error("Lost durable bind checkpoint"))
                  : lease.write(snapshot),
            };
          }),
      };
      const services = resourceServices(counts);
      const stack: Stack = {
        name: "app",
        resources: ["Object", "Legacy"].map((id) => ({
          id,
          type: "object",
          identity: id,
          properties: {},
          protection: { data: true, allowDelete: false },
        })),
      };
      const run = () =>
        Effect.runPromise(deploy(stack, { environment: "test", state, services, yes: true }));
      try {
        await expect(run()).rejects.toThrow("Deployment failed");
        const interrupted = await Effect.runPromise(disk.read("app", "test"));
        expect(interrupted?.pending?.phase).toBe("bindings");
        expect(interrupted?.resources.Object?.outputs).toEqual({ owner: "worker" });
        expect(interrupted?.pending?.applied?.outputs).toEqual({ owner: "worker" });
        expect(interrupted?.outputs).toEqual({});
        loseCheckpoint = false;
        const completed = await run();
        expect(counts.applies).toBe(1);
        expect(counts.observations).toBe(2);
        expect(completed.resources.Object?.outputs).toEqual({
          owner: "worker",
          namespaceId: "provider-namespace",
        });
        expect(completed.resources.Legacy?.outputs).toEqual({ owner: "worker" });
        expect((await Effect.runPromise(disk.read("app", "test")))?.outputs.Object?.value).toEqual(
          completed.resources.Object?.outputs,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
);
