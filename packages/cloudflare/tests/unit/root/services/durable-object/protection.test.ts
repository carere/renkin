import { expect, it } from "@effect/vitest";
import { emptyState } from "@renkin/core/models/state";
import { plan } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
import { durableObject } from "#src/contexts/root/models/durable-object.ts";
import { worker } from "#src/contexts/root/models/worker.ts";
import { prepareDurableObjects } from "#src/contexts/root/services/durable-object/prepare-durable-objects.ts";

const api = worker("Api", { entry: "api.ts", compatibilityDate: "2026-07-30" });
const counters = durableObject("Counters", { worker: "Api", className: "Counter" });
it.effect(
  "empty namespace ownership protects both namespace and owning Worker from removal or replacement",
  () =>
    Effect.sync(() => {
      const resources = prepareDurableObjects([api, counters]);
      const state = emptyState("app", "test");
      for (const definition of resources)
        state.resources[definition.id] = { definition, physicalId: definition.id, outputs: {} };
      expect(() => plan({ name: "app", resources: [] }, state)).toThrow("Deletion protection");
      expect(() =>
        plan(
          {
            name: "app",
            resources: resources.map((resource) =>
              resource.id === "Api" ? { ...resource, identity: "replacement" } : resource,
            ),
          },
          state,
        ),
      ).toThrow("replace of Api");
      expect(() =>
        plan(
          {
            name: "app",
            resources: resources.map((resource) =>
              resource.id === "Counters" ? { ...resource, identity: "replacement" } : resource,
            ),
          },
          state,
        ),
      ).toThrow("replace of Counters");
    }),
);
it.effect(
  "self-bindings are references while arbitrary cross-namespace provisioning cycles fail preflight",
  () =>
    Effect.sync(() => {
      const withRequirement = (id: string, target: string) => ({
        ...worker(id, { entry: "api.ts", compatibilityDate: "2026-07-30" }),
        properties: {
          requirements: { OBJECTS: { type: "cloudflare.durable-object", id: target } },
        },
      });
      const self = prepareDurableObjects([withRequirement("Api", "Counters"), counters]);
      expect(
        plan({ name: "app", resources: self }, emptyState("app", "test")).map((item) => item.id),
      ).toEqual(["Api", "Counters"]);
      const mutual = prepareDurableObjects([
        withRequirement("A", "BObjects"),
        withRequirement("B", "AObjects"),
        durableObject("AObjects", { worker: "A", className: "Counter" }),
        durableObject("BObjects", { worker: "B", className: "Counter" }),
      ]);
      expect(() => plan({ name: "app", resources: mutual }, emptyState("app", "test"))).toThrow(
        "Dependency cycle",
      );
    }),
);
