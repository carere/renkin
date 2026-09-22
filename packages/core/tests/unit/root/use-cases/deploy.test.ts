import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { defineStack, output, type ResourceDefinition } from "#src/contexts/root/models/stack.ts";
import { emptyState } from "#src/contexts/root/models/state.ts";
import { deploy } from "#src/contexts/root/use-cases/deploy.ts";
import { readOutputs } from "#src/contexts/root/use-cases/outputs.ts";
import { plan } from "#src/contexts/root/use-cases/plan.ts";
import { InMemoryStateRepository } from "#test-support/root/services/state/in-memory-state-repository.ts";

const resource = (identity = "one"): ResourceDefinition => ({
  id: "api",
  type: "worker",
  identity,
  properties: { source: "hello" },
});
const stack = defineStack({
  name: "app",
  resources: [resource()],
  outputs: { password: output("secret-value", { secret: true }) },
});
it.effect("persists ownership before apply and hides secret outputs", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const result = yield* deploy(stack, {
      environment: "dev",
      state,
      yes: true,
      services: () => ({
        worker: {
          apply: (_, physicalId) =>
            Effect.sync(() => {
              expect(state.written?.pending?.physicalId).toBe(physicalId);
              return { url: "https://example.test" };
            }),
          remove: () => Effect.sync(() => {}),
        },
      }),
    });
    expect(result.resources.api?.physicalId).toMatch(/^app-dev-api-/);
    state.value = result;
    expect(yield* readOutputs(state, "app", "dev")).toMatchObject({ password: "[REDACTED]" });
  }),
);
it.effect("requires confirmation and force means update, not permission to delete", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const exit = yield* Effect.exit(
      deploy(stack, { environment: "dev", state, services: () => ({}) }),
    );
    expect(exit._tag).toBe("Failure");
    expect(state.written).toBeUndefined();
    const existing = emptyState("app", "dev");
    existing.resources.api = {
      definition: { ...resource(), protection: { data: true, allowDelete: false } },
      physicalId: "old",
      outputs: null,
    };
    expect(plan(stack, existing, true)[0]?.kind).toBe("update");
    expect(() => plan({ ...stack, resources: [resource("two")] }, existing, true)).toThrow(
      "Deletion protection",
    );
    expect(() => plan({ ...stack, resources: [] }, existing, true)).toThrow("Deletion protection");
  }),
);
for (const failingPhase of ["apply", "bindings", "remove"] as const) {
  it.effect(`recovers interruption during ${failingPhase}`, () =>
    Effect.gen(function* () {
      const state = new InMemoryStateRepository();
      let fail = true;
      const options = {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            apply: () =>
              Effect.gen(function* () {
                if (fail && failingPhase === "apply")
                  return yield* Effect.fail(new Error("sensitive-detail"));
                return null;
              }),
            bind: () =>
              Effect.gen(function* () {
                if (fail && failingPhase === "bindings")
                  return yield* Effect.fail(new Error("sensitive-detail"));
              }),
            remove: () =>
              Effect.gen(function* () {
                if (fail && failingPhase === "remove")
                  return yield* Effect.fail(new Error("sensitive-detail"));
              }),
          },
        }),
      };
      if (failingPhase === "remove") {
        state.value = emptyState("app", "dev");
        state.value.resources.api = {
          definition: resource("old"),
          physicalId: "old-id",
          outputs: null,
        };
      }
      expect((yield* Effect.exit(deploy(stack, options)))._tag).toBe("Failure");
      expect(state.written?.pending).toBeDefined();
      const physicalId = state.written?.pending?.physicalId;
      state.value = state.written;
      fail = false;
      const result = yield* deploy(stack, options);
      expect(result.pending).toBeUndefined();
      expect(result.resources.api?.physicalId).toBe(physicalId);
    }),
  );
}
it("treats prototype-like logical IDs as ordinary new resource identities", () => {
  const desired = defineStack({ name: "app", resources: [{ ...resource(), id: "constructor" }] });
  expect(plan(desired, emptyState("app", "dev"))[0]?.kind).toBe("create");
});
it.effect("rechecks current protection before resuming an earlier destructive operation", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const previous = {
      definition: { ...resource("old"), protection: { data: true, allowDelete: true } },
      physicalId: "old",
      outputs: null,
    };
    const desired = { ...resource("new"), protection: { data: true, allowDelete: true } };
    state.value = emptyState("app", "dev");
    state.value.resources.api = previous;
    state.value.pending = {
      change: { id: "api", kind: "replace", previous, desired },
      physicalId: "new",
      phase: "apply",
    };
    const protectedStack = defineStack({
      name: "app",
      resources: [{ ...desired, protection: { data: true, allowDelete: false } }],
    });
    let mutated = false;
    const exit = yield* Effect.exit(
      deploy(protectedStack, {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            apply: () =>
              Effect.sync(() => {
                mutated = true;
                return null;
              }),
            remove: () =>
              Effect.sync(() => {
                mutated = true;
              }),
          },
        }),
      }),
    );
    expect(exit._tag).toBe("Failure");
    expect(mutated).toBe(false);
    expect(state.written).toBeUndefined();
  }),
);
it.effect(
  "removal recovery supplies only identity-preserving explicit permissions and still honors protection",
  () =>
    Effect.gen(function* () {
      const previous = {
        definition: { ...resource(), protection: { data: true, allowDelete: true } },
        physicalId: "owned",
        outputs: null,
      };
      const state = new InMemoryStateRepository();
      const initial = emptyState("app", "dev");
      initial.resources.api = previous;
      initial.pending = {
        change: { id: "api", kind: "remove", previous },
        physicalId: "owned",
        phase: "remove",
      };
      let received: ResourceDefinition | undefined;
      const options = {
        environment: "dev",
        state,
        yes: true,
        force: true,
        services: () => ({
          worker: {
            apply: () =>
              Effect.sync(() => {
                return null;
              }),
            remove: (_resource: unknown, _resources: unknown, current?: ResourceDefinition) =>
              Effect.sync(() => {
                received = current;
              }),
          },
        }),
      };
      const correction = { ...previous.definition, properties: { forceDestroy: true } };
      state.value = structuredClone(initial);
      yield* deploy({ name: "app", resources: [correction] }, options);
      expect(received).toEqual(correction);
      state.value = structuredClone(initial);
      state.written = undefined;
      received = undefined;
      const protectedAgain = { ...correction, protection: { data: true, allowDelete: false } };
      expect(
        (yield* Effect.exit(deploy({ name: "app", resources: [protectedAgain] }, options)))._tag,
      ).toBe("Failure");
      expect(received).toBeUndefined();
      expect(state.written).toBeUndefined();
      state.value = structuredClone(initial);
      received = undefined;
      yield* deploy(
        { name: "app", resources: [{ ...correction, identity: "different" }] },
        options,
      );
      expect(received).toBeUndefined();
    }),
);
it.effect("requests empty environment removal and propagates configured repository failures", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const options = {
      environment: "preview",
      state,
      yes: true,
      removeEmpty: true,
      services: () => ({}),
    };
    yield* deploy({ name: "app", resources: [] }, options);
    expect(state.removeEmptyCalls).toBe(1);
    expect(state.written?.resources).toEqual({});
    state.removeEmptyError = new Error("configured removal failure");
    expect((yield* Effect.exit(deploy({ name: "app", resources: [] }, options)))._tag).toBe(
      "Failure",
    );
    expect(state.removeEmptyCalls).toBe(2);
  }),
);

it.effect(
  "defers execution and finishes a mutation checkpoint before releasing an interrupted deployment",
  () =>
    Effect.gen(function* () {
      const state = new InMemoryStateRepository();
      const started = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      const operation = deploy(stack, {
        environment: "dev",
        state,
        yes: true,
        services: () => ({
          worker: {
            apply: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(proceed);
                return { created: true };
              }),
            remove: () => Effect.void,
          },
        }),
      });
      expect(state.written).toBeUndefined();
      const deploying = yield* Effect.forkChild(operation);
      yield* Deferred.await(started);
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(deploying));
      yield* Effect.yieldNow;
      expect(state.releaseCalls).toBe(0);
      expect(state.written?.pending?.phase).toBe("apply");
      yield* Deferred.succeed(proceed, undefined);
      yield* Fiber.join(interrupting);
      expect(state.releaseCalls).toBe(1);
      expect(state.written?.pending).toBeUndefined();
      expect(state.written?.resources.api?.outputs).toEqual({ created: true });
    }),
);
