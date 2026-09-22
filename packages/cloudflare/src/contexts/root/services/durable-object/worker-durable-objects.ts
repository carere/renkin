import type { DurableObjectExports } from "@renkin/cloudflare-sdk/models/durable-object-exports";
import type { createDurableObjectClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/durable-object-client";
import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { durableObjectProperties, objectProperties } from "./prepare-durable-objects.ts";

const names = (value: unknown): readonly string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error("Invalid owned Durable Object class ledger.");
  return value;
};
const authorizedRetirements = (
  previous: ResourceState | undefined,
  resources: Readonly<Record<string, ResourceState>>,
  desired: readonly ResourceDefinition[],
  observed: Readonly<Record<string, string>>,
) =>
  Object.values(resources).flatMap((resource) => {
    if (resource.definition.type !== "cloudflare.durable-object" || resource.definition.retain)
      return [];
    const owned = objectProperties(resource.outputs);
    if (owned.worker !== previous?.physicalId || typeof owned.className !== "string") return [];
    const next = desired.find((item) => item.id === resource.definition.id);
    const settings = next ?? resource.definition;
    if (!settings.protection?.allowDelete || settings.retain) return [];
    if (next?.type === "cloudflare.durable-object") {
      const target = durableObjectProperties(next);
      if (target.className === owned.className || target.renamedFrom === owned.className) return [];
    }
    const namespaceId = observed[owned.className];
    if (!namespaceId || namespaceId !== owned.namespaceId || !previous) return [];
    return [
      {
        className: owned.className,
        namespaceId,
        scriptName: previous.physicalId,
        ownershipId: previous.ownershipId ?? previous.definition.id,
      },
    ];
  });
export const durableObjectLedger = (
  definition: ResourceDefinition,
  previous?: ResourceState,
  resources: Readonly<Record<string, ResourceState>> = {},
  desired: readonly ResourceDefinition[] = [],
  observed: Readonly<Record<string, string>> = {},
) => ({
  durableObjectRetirements: authorizedRetirements(previous, resources, desired, observed),
  durableObjectClasses: [
    ...new Set([
      ...names(
        previous?.outputs ? objectProperties(previous.outputs).durableObjectClasses : undefined,
      ),
      ...names(
        previous
          ? objectProperties(previous.definition.properties).durableObjectClasses
          : undefined,
      ),
      ...names(objectProperties(definition.properties).durableObjectClasses),
    ]),
  ].sort(),
});

/** Only retire classes recorded in this environment's owned Worker ledger. */
export const durableObjectMetadata = (
  resource: ResourceState,
  resources: Readonly<Record<string, ResourceState>> = {},
  observedClasses: Readonly<Record<string, string>> = {},
): { exports?: DurableObjectExports } => {
  const properties = objectProperties(resource.definition.properties);
  const desired = names(properties.durableObjectClasses);
  const ledger = names(
    resource.outputs ? objectProperties(resource.outputs).durableObjectClasses : undefined,
  );
  if (!desired.length && !ledger.length) return {};
  const exports: Record<string, DurableObjectExports[string]> = {};
  const renamed = objectProperties(properties.durableObjectRenames ?? {});
  const retirements = resource.outputs
    ? objectProperties(resource.outputs).durableObjectRetirements
    : [];
  for (const name of ledger) {
    if (
      !desired.includes(name) &&
      Object.values(resources).some((item) => {
        if (item.definition.type !== "cloudflare.durable-object" || !item.definition.retain)
          return false;
        const owned = objectProperties(item.outputs);
        return owned.worker === resource.physicalId && owned.className === name;
      })
    )
      throw new Error("Retained Durable Object class cannot be retired by its Worker.");
    if (
      !desired.includes(name) &&
      !renamed[name] &&
      observedClasses[name] &&
      !(
        Array.isArray(retirements) &&
        retirements.some((entry) => {
          const grant = objectProperties(entry);
          return (
            grant.className === name &&
            grant.namespaceId === observedClasses[name] &&
            grant.scriptName === resource.physicalId &&
            grant.ownershipId === (resource.ownershipId ?? resource.definition.id)
          );
        })
      )
    )
      throw new Error(
        "Live Durable Object class retirement lacks an owned, explicit deletion authorization.",
      );
    exports[name] = { type: "durable-object", state: "deleted" };
  }
  for (const name of desired) exports[name] = { type: "durable-object", storage: "sqlite" };
  for (const [from, to] of Object.entries(renamed)) {
    if (typeof to !== "string" || !desired.includes(to) || desired.includes(from))
      throw new Error("Invalid Durable Object class rename.");
    exports[from] = { type: "durable-object", state: "renamed", renamed_to: to };
  }
  return { exports };
};
export const observedDurableObjectClasses = (
  scriptName: string,
  client: ReturnType<typeof createDurableObjectClient> | undefined,
) =>
  Effect.gen(function* () {
    const result: Record<string, string> = {};
    if (!client) return result;
    for (const item of yield* client.list()) {
      if (item.script !== scriptName) continue;
      if (!item.class || !item.id || result[item.class])
        return yield* Effect.fail(
          new Error("Durable Object namespace inventory is incomplete or ambiguous."),
        );
      result[item.class] = item.id;
    }
    return result;
  });
export const prepareDurableObjectLedger = (
  definition: ResourceDefinition,
  previous: ResourceState | undefined,
  resources: Readonly<Record<string, ResourceState>>,
  desired: readonly ResourceDefinition[],
  client: ReturnType<typeof createDurableObjectClient> | undefined,
) =>
  Effect.gen(function* () {
    return durableObjectLedger(
      definition,
      previous,
      resources,
      desired,
      previous ? yield* observedDurableObjectClasses(previous.physicalId, client) : {},
    );
  });
export const assertNoDurableObjects = (
  scriptName: string,
  client: ReturnType<typeof createDurableObjectClient> | undefined,
) =>
  Effect.gen(function* () {
    if (client && (yield* client.list()).some((item) => item.script === scriptName))
      return yield* Effect.fail(
        new Error("Owning Worker cannot be removed while Durable Object namespaces remain."),
      );
  });
