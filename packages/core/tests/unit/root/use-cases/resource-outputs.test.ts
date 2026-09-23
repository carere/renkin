import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { output, type ResourceDefinition } from "#src/contexts/root/models/stack.ts";
import { emptyState } from "#src/contexts/root/models/state.ts";
import { resolveTextBinding, resourceOutput, secret } from "#src/contexts/root/models/value.ts";
import { deploy } from "#src/contexts/root/use-cases/deploy.ts";
import { readOutputs } from "#src/contexts/root/use-cases/outputs.ts";
import { plan } from "#src/contexts/root/use-cases/plan.ts";
import { InMemoryStateRepository } from "#test-support/root/services/state/in-memory-state-repository.ts";

const token: ResourceDefinition<{ clientSecret: string }> = {
  id: "token",
  type: "token",
  identity: "token",
  properties: {},
  secretOutputs: true,
};

it.effect("resolves nested output aliases after provisioning and cannot downgrade secrets", () =>
  Effect.gen(function* () {
    const state = new InMemoryStateRepository();
    const reference = resourceOutput(token, "clientSecret");
    const stack = {
      name: "app",
      resources: [token],
      outputs: {
        alias: output({ credentials: [reference] }, { secret: false }),
      },
    };
    state.value = yield* deploy(stack, {
      environment: "test",
      state,
      yes: true,
      services: () => ({
        token: {
          apply: () => Effect.succeed({ clientSecret: "provider-secret" }),
          remove: () => Effect.void,
        },
      }),
    });
    expect(state.value.outputs.alias).toEqual({
      value: { credentials: ["provider-secret"] },
      secret: true,
    });
    expect(yield* readOutputs(state, "app", "test")).toMatchObject({ alias: "[REDACTED]" });
    expect(yield* readOutputs(state, "app", "test", { revealSecrets: true })).toMatchObject({
      alias: { credentials: ["provider-secret"] },
    });
    expect(JSON.stringify(stack)).not.toContain("provider-secret");
  }),
);

it.effect("validates missing and mistyped references before making changes", () =>
  Effect.sync(() => {
    const stack = {
      name: "app",
      resources: [],
      outputs: { token: output(resourceOutput(token, "clientSecret")) },
    };
    expect(() => plan(stack, emptyState("app", "test"))).toThrow("missing or has another type");
    expect(() =>
      plan({ ...stack, resources: [{ ...token, type: "other" }] }, emptyState("app", "test")),
    ).toThrow("missing or has another type");
  }),
);

it.effect(
  "requires local values and rejects unavailable or nonstring Worker outputs without exposing data",
  () =>
    Effect.sync(() => {
      const reference = resourceOutput(token, "clientSecret");
      expect(() => resolveTextBinding(reference, {}, true)).toThrow("explicit local value");
      expect(
        resolveTextBinding(
          resourceOutput(token, "clientSecret", { local: "local-only" }),
          {},
          true,
        ),
      ).toEqual({ text: "local-only", secret: true });
      expect(() => resolveTextBinding(reference, {})).toThrow("unavailable");
      const resources = {
        token: {
          definition: token,
          physicalId: "id",
          outputs: { clientSecret: { sensitive: "not-text" } },
        },
      };
      expect(() => resolveTextBinding(reference, resources)).toThrow("must be a string");
      expect(() => secret("not a variable or a secret value")).toThrow("variable name");
      expect(() => resolveTextBinding(secret("RENKIN_MISSING_TEST_SECRET"), {})).toThrow(
        "Required secret",
      );
    }),
);
