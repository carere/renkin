import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ResourceDefinition, Stack } from "#src/contexts/root/models/stack.ts";
import { emptyState } from "#src/contexts/root/models/state.ts";
import { deploy } from "#src/contexts/root/use-cases/deploy.ts";
import { plan } from "#src/contexts/root/use-cases/plan.ts";
import { InMemoryStateRepository } from "#test-support/root/services/state/in-memory-state-repository.ts";

const definition = (id: string): ResourceDefinition => ({
  id,
  type: "worker",
  identity: "stable",
  properties: {},
});
it.effect(
  "redirects every caller before deleting a replaced mutual target and recovers deletion",
  () =>
    Effect.gen(function* () {
      const state = new InMemoryStateRepository();
      state.value = emptyState("app", "dev");
      for (const id of ["a", "b"]) {
        state.value.resources[id] = {
          definition: definition(id),
          physicalId: `old-${id}`,
          outputs: null,
        };
      }
      const events: string[] = [];
      let fail = true;
      const stack = {
        name: "app",
        resources: [{ ...definition("b"), identity: "replacement" }, definition("a")],
      };
      const options = {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            deferredBindings: true,
            refresh: true,
            apply: () =>
              Effect.sync(() => {
                return null;
              }),
            bind: (resource: { definition: ResourceDefinition }) =>
              Effect.sync(() => {
                events.push(`bind:${resource.definition.id}`);
              }),
            remove: () =>
              Effect.gen(function* () {
                events.push("delete:old-b");
                expect(events).toContain("bind:a");
                if (fail)
                  return yield* Effect.fail(new Error("interrupted after callers were redirected"));
              }),
          },
        }),
      };
      expect((yield* Effect.exit(deploy(stack, options)))._tag).toBe("Failure");
      expect(events).toEqual(["bind:b", "bind:a", "delete:old-b"]);
      state.value = state.written;
      const replacement = state.value?.resources.b?.physicalId;
      expect(replacement).not.toBe("old-b");
      fail = false;
      const result = yield* deploy(stack, options);
      expect(result.resources.b?.physicalId).toBe(replacement);
      expect(result.pending).toBeUndefined();
    }),
);
it.effect("finishes interrupted bindings before removing graph targets", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    state.value = emptyState("app", "dev");
    const target = { definition: definition("target"), physicalId: "target", outputs: null };
    const caller = { definition: definition("caller"), physicalId: "caller", outputs: null };
    Object.assign(state.value.resources, { target, caller });
    state.value.bindings = [
      {
        change: { id: "caller", kind: "create", desired: caller.definition },
        physicalId: "caller",
        phase: "bindings",
        applied: caller,
      },
    ];
    const events: string[] = [];
    yield* deploy(
      { name: "app", resources: [] },
      {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            deferredBindings: true,
            apply: () =>
              Effect.sync(() => {
                return null;
              }),
            bind: (_resource, resources) =>
              Effect.sync(() => {
                expect(resources.target).toBeDefined();
                events.push("bind");
              }),
            remove: () =>
              Effect.sync(() => {
                events.push("remove");
              }),
          },
        }),
      },
    );
    expect(events).toEqual(["bind", "remove", "remove"]);
  }),
);
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
          apply: () =>
            Effect.sync(() => {
              return null;
            }),
          bind: (_: unknown, resources: Readonly<Record<string, unknown>>) =>
            Effect.gen(function* () {
              expect(Object.keys(resources).sort()).toEqual(["a", "b"]);
              if (fail) return yield* Effect.fail(new Error("interrupted binding"));
            }),
          remove: () => Effect.sync(() => {}),
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
            apply: () =>
              Effect.sync(() => {
                return { id: "provider-id" };
              }),
            resolvePhysicalId: () => "provider-id",
            bind: () =>
              Effect.sync(() => {
                expect(state.written?.pending?.physicalId).toBe("provider-id");
              }),
            remove: () => Effect.sync(() => {}),
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
          apply: () =>
            Effect.gen(function* () {
              return yield* Effect.fail(new Error("unexpected mutation"));
            }),
          remove: () =>
            Effect.gen(function* () {
              return yield* Effect.fail(new Error("unexpected mutation"));
            }),
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
              apply: () =>
                Effect.sync(() => {
                  mutations++;
                  return null;
                }),
              remove: () =>
                Effect.sync(() => {
                  mutations++;
                }),
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
it.effect(
  "persists force across a lost binding response without granting deletion permission",
  () =>
    Effect.gen(function* () {
      const state = new InMemoryStateRepository();
      let fail = true;
      const observed: boolean[] = [];
      const stack = { name: "app", resources: [definition("api")] };
      const services = () => ({
        worker: {
          apply: () =>
            Effect.sync(() => {
              return null;
            }),
          bind: (
            _resource: unknown,
            _resources: unknown,
            _desired: unknown,
            options?: {
              readonly force?: boolean;
            },
          ) =>
            Effect.gen(function* () {
              observed.push(options?.force ?? false);
              if (fail) return yield* Effect.fail(new Error("lost response"));
            }),
          remove: () => Effect.sync(() => {}),
        },
      });
      expect(
        (yield* Effect.exit(
          deploy(stack, { environment: "dev", state, services, yes: true, force: true }),
        ))._tag,
      ).toBe("Failure");
      state.value = state.written;
      fail = false;
      yield* deploy(stack, { environment: "dev", state, services, yes: true });
      expect(observed).toEqual([true, true]);
    }),
);
it.effect("supplies corrected same-identity configuration while recovering a binding", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const desired = { ...definition("data"), properties: { migration: "fixed" } };
    const previous = { ...desired, properties: { migration: "failed" } };
    const applied = { definition: previous, physicalId: "same-database", outputs: null };
    state.value = emptyState("app", "dev");
    state.value.pending = {
      change: { id: "data", kind: "create", desired: previous },
      physicalId: "same-database",
      phase: "bindings",
      applied,
    };
    const observed: unknown[] = [];
    yield* deploy(
      { name: "app", resources: [desired] },
      {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            apply: () =>
              Effect.sync(() => {
                return null;
              }),
            bind: (_resource, _resources, current) =>
              Effect.sync(() => {
                observed.push(current?.properties);
              }),
            remove: () => Effect.sync(() => {}),
          },
        }),
      },
    );
    expect(observed[0]).toEqual({ migration: "fixed" });
    expect(state.written?.resources.data?.definition).toEqual(desired);
  }),
);
it.effect(
  "retention keeps the provider object while explicitly dropping its ownership record",
  () =>
    Effect.gen(function* () {
      const state = new InMemoryStateRepository();
      state.value = emptyState("app", "dev");
      state.value.resources.data = {
        definition: {
          ...definition("data"),
          retain: true,
          protection: { data: true, allowDelete: false },
        },
        physicalId: "retained",
        outputs: null,
      };
      let removed = false;
      const result = yield* deploy(
        { name: "app", resources: [] },
        {
          environment: "dev",
          state,
          yes: true,
          services: () => ({
            worker: {
              apply: () =>
                Effect.sync(() => {
                  return null;
                }),
              remove: () =>
                Effect.sync(() => {
                  removed = true;
                }),
            },
          }),
        },
      );
      expect(removed).toBe(false);
      expect(result.resources).toEqual({});
    }),
);
