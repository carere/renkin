import { expect, it } from "@effect/vitest";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { durableObject } from "#src/contexts/root/models/durable-object.ts";
import {
  durableObjectLedger,
  durableObjectMetadata,
} from "#src/contexts/root/services/durable-object/worker-durable-objects.ts";

const owner: ResourceState = {
  definition: {
    id: "Api",
    type: "cloudflare.worker",
    identity: "worker",
    properties: { durableObjectClasses: [] },
  },
  physicalId: "owned-api",
  outputs: { durableObjectClasses: ["Counter"] },
};
const object: ResourceState = {
  definition: durableObject("Counters", { worker: "Api", className: "Counter", allowDelete: true }),
  physicalId: "allocation",
  outputs: { worker: "owned-api", className: "Counter", namespaceId: "old-namespace" },
};
it.effect(
  "retirement grants bind namespace incarnation and owner, then expire with owned intent",
  () =>
    Effect.sync(() => {
      const ledger = durableObjectLedger(owner.definition, owner, { Counters: object }, [], {
        Counter: "old-namespace",
      });
      const authorized = { ...owner, outputs: ledger };
      expect(
        durableObjectMetadata(authorized, {}, { Counter: "old-namespace" }).exports?.Counter,
      ).toEqual({ type: "durable-object", state: "deleted" });
      expect(() => durableObjectMetadata(authorized, {}, { Counter: "new-namespace" })).toThrow(
        "authorization",
      );
      expect(() =>
        durableObjectMetadata(
          { ...authorized, physicalId: "different-owner" },
          {},
          { Counter: "old-namespace" },
        ),
      ).toThrow("authorization");
      const forgotten = {
        ...owner,
        outputs: durableObjectLedger(owner.definition, authorized, {}, [], {
          Counter: "old-namespace",
        }),
      };
      expect(() => durableObjectMetadata(forgotten, {}, { Counter: "old-namespace" })).toThrow(
        "authorization",
      );
      expect(durableObjectMetadata(forgotten, {}, {}).exports?.Counter).toEqual({
        type: "durable-object",
        state: "deleted",
      });
    }),
);
it.effect(
  "retained resources never grant retirement and cannot authorize owner updates afterward",
  () =>
    Effect.sync(() => {
      const retained = { ...object, definition: { ...object.definition, retain: true } };
      const outputs = durableObjectLedger(owner.definition, owner, { Counters: retained }, [], {
        Counter: "native",
      });
      expect(outputs.durableObjectRetirements).toEqual([]);
      expect(() => durableObjectMetadata({ ...owner, outputs }, {}, { Counter: "native" })).toThrow(
        "authorization",
      );
    }),
);
