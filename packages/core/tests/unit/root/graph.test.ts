import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ResourceDefinition, Stack } from "../../../src/contexts/root/models/stack.ts";
import { emptyState } from "../../../src/contexts/root/models/state.ts";
import { deploy } from "../../../src/contexts/root/use-cases/deploy.ts";
import { plan } from "../../../src/contexts/root/use-cases/plan.ts";
import { InMemoryStateRepository } from "../../support/root/services/state/in-memory-state-repository.ts";

const definition = (id: string): ResourceDefinition => ({
  id,
  type: "worker",
  identity: "stable",
  properties: {},
});

it.effect("provisions mutual call targets before binding and recovers binding interruption", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    let fail = true;
    const stack: Stack = {
      name: "app",
      resources: [
        { ...definition("a"), references: ["b"] },
        { ...definition("b"), references: ["a"] },
      ],
    };
    const options = {
      environment: "dev",
      state,
      yes: true,
      services: () => ({
        worker: {
          deferredBindings: true,
          apply: async () => null,
          bind: async (_: unknown, resources: Readonly<Record<string, unknown>>) => {
            expect(Object.keys(resources).sort()).toEqual(["a", "b"]);
            if (fail) throw new Error("interrupted binding");
          },
          remove: async () => {},
        },
      }),
    };
    expect((yield* Effect.exit(deploy(stack, options)))._tag).toBe("Failure");
    state.value = state.written;
    const ids = Object.values(state.value?.resources ?? {}).map((resource) => resource.physicalId);
    fail = false;
    const recovered = yield* deploy(stack, options);
    expect(Object.values(recovered.resources).map((resource) => resource.physicalId)).toEqual(ids);
    expect(recovered.pending).toBeUndefined();
    expect(recovered.bindings).toBeUndefined();
  }),
);

it.effect("checkpoints server-assigned identity before binding", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const result = yield* deploy(
      { name: "app", resources: [definition("kv")] },
      {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            apply: async () => ({ id: "provider-id" }),
            resolvePhysicalId: () => "provider-id",
            bind: async () => expect(state.written?.pending?.physicalId).toBe("provider-id"),
            remove: async () => {},
          },
        }),
      },
    );
    expect(result.resources.kv?.physicalId).toBe("provider-id");
  }),
);

it.effect("renames protected resources without provider changes and preserves ownership", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    state.value = emptyState("app", "dev");
    state.value.resources.old = {
      definition: { ...definition("old"), protection: { data: true, allowDelete: false } },
      physicalId: "original",
      outputs: { value: "saved" },
    };
    const stack: Stack = {
      name: "app",
      renames: [{ from: "old", to: "new" }],
      resources: [{ ...definition("new"), protection: { data: true, allowDelete: false } }],
    };
    const options = {
      environment: "dev",
      state,
      yes: true,
      services: () => ({
        worker: {
          apply: async () => {
            throw new Error("unexpected mutation");
          },
          remove: async () => {
            throw new Error("unexpected mutation");
          },
        },
      }),
    };
    const result = yield* deploy(stack, options);
    expect(result.resources.old).toBeUndefined();
    expect(result.resources.new).toMatchObject({
      physicalId: "original",
      ownershipId: "old",
      outputs: { value: "saved" },
    });
    state.value = state.written;
    expect((yield* deploy(stack, options)).resources.new?.physicalId).toBe("original");
    expect(() => plan({ ...stack, resources: [] }, result)).toThrow();
  }),
);

it.effect("rejects a protected mixed plan before any mutations even with yes and force", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    state.value = emptyState("app", "dev");
    state.value.resources.data = {
      definition: { ...definition("data"), protection: { data: true, allowDelete: false } },
      physicalId: "empty-protected",
      outputs: null,
    };
    let mutations = 0;
    const exit = yield* Effect.exit(
      deploy(
        { name: "app", resources: [definition("new")] },
        {
          environment: "dev",
          state,
          yes: true,
          force: true,
          services: () => ({
            worker: {
              apply: async () => {
                mutations++;
                return null;
              },
              remove: async () => {
                mutations++;
              },
            },
          }),
        },
      ),
    );
    expect(exit._tag).toBe("Failure");
    expect(mutations).toBe(0);
    expect(state.written).toBeUndefined();
  }),
);
