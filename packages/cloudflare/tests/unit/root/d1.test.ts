import { expect, it } from "@effect/vitest";
import { emptyState } from "@renkin/core/models/state";
import { plan } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
import { d1 } from "../../../src/contexts/root/models/d1.ts";

it.effect(
  "D1 rejects mixed destructive plans before work, including empty databases and forced runs",
  () =>
    Effect.sync(() => {
      const resource = d1("database");
      const state = emptyState("app", "test");
      state.resources.database = {
        definition: resource,
        physicalId: "provider-id",
        outputs: { id: "provider-id" },
        ownershipId: "database",
      };
      for (const force of [false, true]) {
        expect(() => plan({ name: "app", resources: [d1("another")] }, state, force)).toThrow(
          "Deletion protection",
        );
        expect(() =>
          plan({ name: "app", resources: [d1("database", { jurisdiction: "eu" })] }, state, force),
        ).toThrow("Deletion protection");
      }
      expect(
        plan(
          { name: "app", resources: [d1("database", { jurisdiction: "eu", allowDelete: true })] },
          state,
        )[0]?.kind,
      ).toBe("replace");
      const enabled = d1("database", { allowDelete: true });
      state.resources.database = {
        definition: enabled,
        physicalId: "provider-id",
        outputs: { id: "provider-id" },
        ownershipId: "database",
      };
      expect(plan({ name: "app", resources: [] }, state)[0]?.kind).toBe("remove");
    }),
);
