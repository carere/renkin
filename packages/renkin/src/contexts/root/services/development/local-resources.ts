import { randomUUID } from "node:crypto";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import { durableObjectProperties } from "@renkin/cloudflare/services/durable-object/prepare-durable-objects";
import type { Stack } from "@renkin/core/models/stack";
import type { Change, EnvironmentState } from "@renkin/core/models/state";
import { resolveTextBinding } from "@renkin/core/models/value";
import { plan } from "@renkin/core/use-cases/plan";
import { renamedState } from "@renkin/core/use-cases/rename";
import type { LocalQueue, LocalWorkflow } from "@renkin/runtime/services/local/local-background";
import type { LocalDurableObject } from "@renkin/runtime/services/local/local-durable-objects";
import { removeLocalR2Objects } from "@renkin/runtime/services/local/local-r2-removal";
import { Effect } from "effect";

const cloudOnlyControls = new Set([
  "cloudflare.access-service-token",
  "cloudflare.access-policy",
  "cloudflare.access-application",
  "cloudflare.custom-domain",
  "cloudflare.observability-destination",
]);
const r2Removals = (changes: Iterable<Change>) =>
  [...changes].flatMap((change) => {
    if (
      (change.kind !== "remove" && change.kind !== "replace") ||
      change.previous?.definition.type !== "cloudflare.r2" ||
      change.previous.definition.retain
    )
      return [];
    const properties = (change.desired ?? change.previous.definition).properties;
    return [
      {
        physicalId: change.previous.physicalId,
        forceDestroy:
          !!properties &&
          typeof properties === "object" &&
          !Array.isArray(properties) &&
          "forceDestroy" in properties &&
          properties.forceDestroy === true,
      },
    ];
  });
const tokenBuckets = (value: unknown) => {
  const properties = value;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties) ||
    !("buckets" in properties) ||
    !Array.isArray(properties.buckets) ||
    !properties.buckets.every((id) => typeof id === "string")
  )
    throw new Error("Invalid local R2 token buckets.");
  return properties.buckets as readonly string[];
};
const localWorker = (resource: WorkerResource) => ({
  id: resource.id,
  ...resource.options,
  bindings: Object.fromEntries(
    Object.entries(resource.options.bindings ?? {}).map(([name, value]) => [
      name,
      resolveTextBinding(value, {}, true).text,
    ]),
  ),
});
export const prepareLocalResources = (stack: Stack, state: EnvironmentState, persist: string) =>
  Effect.gen(function* () {
    const changes = new Map(plan(stack, state).map((change) => [change.id, change]));
    yield* Effect.tryPromise({
      try: () => removeLocalR2Objects(persist, r2Removals(changes.values())),
      catch: (error) => error,
    });
    state = renamedState(stack, state);
    const namespaces: Record<string, string> = {};
    const databases: Record<string, string> = {};
    const durableObjects: Record<string, LocalDurableObject> = {};
    const buckets: Record<string, string> = {};
    const r2Tokens: Record<string, readonly string[]> = {};
    const queues: Record<string, LocalQueue> = {};
    const workflows: Record<string, LocalWorkflow> = {};
    const workerResources: WorkerResource[] = [];
    for (const resource of stack.resources) {
      const previous =
        changes.get(resource.id)?.kind === "replace" ? undefined : state.resources[resource.id];
      state.resources[resource.id] = {
        definition: resource,
        physicalId: previous?.physicalId ?? randomUUID(),
        outputs: previous?.outputs ?? null,
        ownershipId: previous?.ownershipId ?? resource.id,
      };
      if (resource.type === "cloudflare.kv")
        namespaces[resource.id] = state.resources[resource.id]?.physicalId ?? resource.id;
      else if (resource.type === "cloudflare.d1")
        databases[resource.id] = state.resources[resource.id]?.physicalId ?? resource.id;
      else if (resource.type === "cloudflare.durable-object")
        durableObjects[resource.id] = {
          ...durableObjectProperties(resource),
          namespace: state.resources[resource.id]?.physicalId ?? resource.id,
        };
      else if (resource.type === "cloudflare.r2")
        buckets[resource.id] = state.resources[resource.id]?.physicalId ?? resource.id;
      else if (resource.type === "cloudflare.r2-token") {
        r2Tokens[resource.id] = tokenBuckets(resource.properties);
      } else if (resource.type === "cloudflare.queue") {
        const properties = resource.properties as { deliveryDelay?: number };
        queues[resource.id] = {
          name: state.resources[resource.id]?.physicalId ?? resource.id,
          deliveryDelay: properties.deliveryDelay,
        };
      } else if (resource.type === "cloudflare.workflow") {
        const properties = resource.properties as { worker: string; className: string };
        workflows[resource.id] = {
          name: state.resources[resource.id]?.physicalId ?? resource.id,
          scriptName: properties.worker,
          className: properties.className,
        };
      } else if (resource.type === "cloudflare.worker" && "options" in resource)
        workerResources.push(resource as WorkerResource);
      else if (!cloudOnlyControls.has(resource.type))
        return yield* Effect.fail(new Error("Unsupported local resource."));
    }
    for (const id of Object.keys(state.resources))
      if (!stack.resources.some((resource) => resource.id === id)) delete state.resources[id];
    return {
      state,
      workers: workerResources.map(localWorker),
      namespaces,
      databases,
      durableObjects,
      buckets,
      r2Tokens,
      queues,
      workflows,
    };
  });
