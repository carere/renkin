import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Stack } from "#src/contexts/root/models/stack.ts";
import { emptyState } from "#src/contexts/root/models/state.ts";
import { FileStateRepository } from "#src/contexts/root/services/state/file-state-repository.ts";
import type { StateRepository } from "#src/contexts/root/services/state/state-repository.ts";
import { deploy } from "#src/contexts/root/use-cases/deploy.ts";
import { plan } from "#src/contexts/root/use-cases/plan.ts";

const crashAfterRename = (disk: FileStateRepository): StateRepository => {
  let crash = true;
  const state: StateRepository = {
    read: (stack, env) => disk.read(stack, env),
    list: (stack) => disk.list(stack),
    acquire: async (stack, env) => {
      const lease = await disk.acquire(stack, env);
      return {
        ...lease,
        write: async (value) => {
          await lease.write(value);
          if (crash && value.resources.renamed) {
            crash = false;
            throw new Error("Crash after atomic write");
          }
        },
      };
    },
  };
  return state;
};

const noMutation = {
  apply: async () => {
    throw new Error("Unexpected provider change");
  },
  remove: async () => {
    throw new Error("Unexpected removal");
  },
};
it.effect(
  "recovers a crash after the atomic rename checkpoint without changing data identity or references",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "renkin-rename-"));
      const disk = new FileStateRepository(directory);
      const before = emptyState("app", "dev");
      const definition = {
        id: "old",
        type: "kv",
        identity: "stable",
        properties: {},
        protection: { data: true, allowDelete: false },
      };
      before.resources.old = {
        definition,
        physicalId: "namespace-with-data",
        outputs: { id: "namespace-with-data" },
      };
      before.resources.api = {
        definition: {
          id: "api",
          type: "worker",
          identity: "stable",
          properties: {},
          dependencies: ["old"],
        },
        physicalId: "worker",
        outputs: null,
      };
      const lease = await disk.acquire("app", "dev");
      await lease.write(before);
      await lease.release();
      const state = crashAfterRename(disk);
      const desired: Stack = {
        name: "app",
        renames: [{ from: "old", to: "renamed" }],
        resources: [
          { ...definition, id: "renamed" },
          { ...before.resources.api.definition, dependencies: ["renamed"] },
        ],
      };
      const options = {
        environment: "dev",
        state,
        yes: true,
        services: () => ({ kv: noMutation, worker: noMutation }),
      };
      try {
        expect((await Effect.runPromise(Effect.exit(deploy(desired, options))))._tag).toBe(
          "Failure",
        );
        const recovered = await Effect.runPromise(deploy(desired, options));
        expect(recovered.resources.renamed?.physicalId).toBe("namespace-with-data");
        expect(recovered.resources.api?.definition.dependencies).toEqual(["renamed"]);
        expect(recovered.resources.old).toBeUndefined();
        expect(() =>
          plan({ ...desired, renames: [{ from: "renamed", to: "api" }] }, recovered),
        ).toThrow();
        expect(() =>
          plan(
            {
              ...desired,
              renames: [{ from: "renamed", to: "next" }],
              resources: [{ ...definition, id: "next", type: "other" }],
            },
            recovered,
          ),
        ).toThrow("resource type");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
);
