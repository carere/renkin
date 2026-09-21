import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Stack } from "../../../src/contexts/root/models/stack.ts";
import { FileStateRepository } from "../../../src/contexts/root/services/state/file-state-repository.ts";
import type { StateRepository } from "../../../src/contexts/root/services/state/state-repository.ts";
import { deploy } from "../../../src/contexts/root/use-cases/deploy.ts";

it.effect("recovers create success before checkpoint and interrupted update and removal", () =>
  Effect.promise(async () => {
    const directory = await mkdtemp(join(tmpdir(), "renkin-recovery-"));
    const disk = new FileStateRepository(directory);
    let failWrite = true;
    let failOperation = false;
    let seenId: string | undefined;
    const interrupted: StateRepository = {
      read: (stack, env) => disk.read(stack, env),
      list: (stack) => disk.list(stack),
      acquire: async (stack, env) => {
        const lease = await disk.acquire(stack, env);
        return {
          ...lease,
          write: async (state) => {
            if (failWrite && state.pending?.phase === "bindings")
              throw new Error("Simulated crash after provider success");
            await lease.write(state);
          },
        };
      },
    };
    const services = () => ({
      worker: {
        apply: async (_: unknown, id: string) => {
          seenId = id;
          if (failOperation) throw new Error("interrupted");
          return { version: 1 };
        },
        remove: async () => {
          if (failOperation) throw new Error("interrupted");
        },
      },
    });
    const stack: Stack = {
      name: "app",
      resources: [{ id: "api", type: "worker", identity: "api", properties: { version: 1 } }],
    };
    const run = (desired: Stack) =>
      Effect.runPromise(
        deploy(desired, { environment: "dev", state: interrupted, services, yes: true }),
      );
    try {
      await expect(run(stack)).rejects.toThrow("Deployment failed");
      const createdId = seenId;
      failWrite = false;
      expect((await run(stack)).resources.api?.physicalId).toBe(createdId);
      const updated: Stack = {
        ...stack,
        resources: stack.resources.map((r) => ({ ...r, properties: { version: 2 } })),
      };
      failOperation = true;
      await expect(run(updated)).rejects.toThrow("Deployment failed");
      failOperation = false;
      expect((await run(updated)).resources.api?.physicalId).toBe(createdId);
      failOperation = true;
      await expect(run({ ...stack, resources: [] })).rejects.toThrow("Deployment failed");
      expect((await disk.read("app", "dev"))?.resources.api?.physicalId).toBe(createdId);
      failOperation = false;
      expect((await run({ ...stack, resources: [] })).resources).toEqual({});
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }),
);
