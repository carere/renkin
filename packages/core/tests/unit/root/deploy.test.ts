import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  defineStack,
  output,
  type ResourceDefinition,
} from "../../../src/contexts/root/models/stack.ts";
import { emptyState } from "../../../src/contexts/root/models/state.ts";
import { deploy } from "../../../src/contexts/root/use-cases/deploy.ts";
import { readOutputs } from "../../../src/contexts/root/use-cases/outputs.ts";
import { plan } from "../../../src/contexts/root/use-cases/plan.ts";
import { InMemoryStateRepository } from "../../support/root/services/state/in-memory-state-repository.ts";

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
          apply: async (_, physicalId) => {
            expect(state.written?.pending?.physicalId).toBe(physicalId);
            return { url: "https://example.test" };
          },
          remove: async () => {},
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
            apply: async () => {
              if (fail && failingPhase === "apply") throw new Error("sensitive-detail");
              return null;
            },
            bind: async () => {
              if (fail && failingPhase === "bindings") throw new Error("sensitive-detail");
            },
            remove: async () => {
              if (fail && failingPhase === "remove") throw new Error("sensitive-detail");
            },
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
