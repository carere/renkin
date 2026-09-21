import type { createCloudflareClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { createDurableObjectClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/durable-object-client";
import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
import { durableObjectProperties, objectProperties } from "./prepare-durable-objects.ts";

export interface DurableObjectServiceOptions {
  readonly client: ReturnType<typeof createDurableObjectClient>;
  readonly workers: ReturnType<typeof createCloudflareClient>;
  readonly token: string;
  readonly stack: string;
  readonly environment: string;
  readonly desired: readonly ResourceDefinition[];
}
const namespaceOwner = (resource: ResourceState) => {
  const value = objectProperties(resource.outputs);
  if (typeof value.worker !== "string" || typeof value.className !== "string")
    throw new Error("Durable Object ownership checkpoint is missing.");
  return {
    worker: value.worker,
    className: value.className,
    namespaceId: typeof value.namespaceId === "string" ? value.namespaceId : undefined,
  };
};
const verifyWorker = async (owner: ResourceState, options: DurableObjectServiceOptions) => {
  const observed = await Effect.runPromise(options.workers.getWorker(owner.physicalId));
  const prefix = `renkin:${options.stack}:${options.environment}:`;
  if (
    !observed.tags?.some(
      (tag) =>
        tag === `${prefix}${owner.physicalId}` ||
        tag === `${prefix}${owner.ownershipId ?? owner.definition.id}`,
    )
  )
    throw new Error("Durable Object owning Worker belongs to another environment.");
  return observed;
};

const retireOwner = async (
  owner: ResourceState,
  resources: Readonly<Record<string, ResourceState>>,
  options: DurableObjectServiceOptions,
) => {
  if (options.desired.some((item) => item.id === owner.definition.id))
    throw new Error("Retained Worker must publish its class removal before namespace retirement.");
  if (!owner.definition.protection?.allowDelete || owner.definition.retain)
    throw new Error("Deletion protection blocks retirement of the Durable Object owning Worker.");
  const observed = await verifyWorker(owner, options);
  const namespaces = (await Effect.runPromise(options.client.list())).filter(
    (item) => item.script === owner.physicalId,
  );
  const exports: Record<string, { type: "durable-object"; state: "deleted" }> = {};
  for (const namespace of namespaces) {
    const owned = Object.values(resources).find((item) => {
      if (item.definition.type !== "cloudflare.durable-object") return false;
      const recorded = namespaceOwner(item);
      return (
        recorded.worker === owner.physicalId &&
        recorded.className === namespace.class &&
        recorded.namespaceId === namespace.id
      );
    });
    if (!owned?.definition.protection?.allowDelete || owned.definition.retain || !namespace.class)
      throw new Error("Namespace retirement cannot remove an unowned or protected class.");
    exports[namespace.class] = { type: "durable-object", state: "deleted" };
  }
  const properties = objectProperties(owner.definition.properties);
  await Effect.runPromise(
    options.workers.putWorker(
      {
        scriptName: owner.physicalId,
        metadata: {
          mainModule: "worker.mjs",
          compatibilityDate: String(properties.compatibilityDate),
          exports,
          tags: observed.tags ?? [],
        },
        files: [
          new File(
            [
              'export default {fetch(){return new Response("Environment is being removed",{status:503})}}',
            ],
            "worker.mjs",
            { type: "application/javascript+module" },
          ),
        ],
      },
      options.token,
    ),
  );
};

const applyNamespace =
  (options: DurableObjectServiceOptions): ResourceService["apply"] =>
  async (definition, _allocation, previous, resources = {}) => {
    const properties = durableObjectProperties(definition);
    const owner = resources[properties.worker];
    if (owner?.definition.type !== "cloudflare.worker")
      throw new Error("Durable Object owner is not provisioned.");
    await verifyWorker(owner, options);
    const observed = (await Effect.runPromise(options.client.list())).filter(
      (item) =>
        item.script === owner.physicalId &&
        (item.class === properties.className || item.class === properties.renamedFrom),
    );
    if (!previous && observed.length)
      throw new Error("Cannot adopt an existing Durable Object namespace.");
    const replacement =
      previous &&
      previous.definition.identity !== definition.identity &&
      definition.protection?.allowDelete;
    if (replacement && observed.length)
      throw new Error(
        "Namespace replacement cannot adopt an existing class; use a new class or an identity-preserving rename.",
      );
    if (previous) {
      const recorded = namespaceOwner(previous);
      if (
        recorded.worker !== owner.physicalId ||
        (!replacement &&
          recorded.className !== properties.className &&
          recorded.className !== properties.renamedFrom)
      )
        throw new Error("Durable Object ownership changed without an explicit class migration.");
      if (
        !replacement &&
        recorded.namespaceId &&
        (observed.length !== 1 || observed[0]?.id !== recorded.namespaceId)
      )
        throw new Error(
          "Durable Object namespace identity changed or disappeared outside this deployment.",
        );
    }
    const nativeId = previous && !replacement ? namespaceOwner(previous).namespaceId : undefined;
    return {
      worker: owner.physicalId,
      className: properties.className,
      ...(nativeId ? { namespaceId: nativeId } : {}),
    };
  };

/** Publication creates native namespaces; a successful deployment must verify each afterward. */
export const cloudflareDurableObjectService = (
  options: DurableObjectServiceOptions,
): ResourceService => ({
  deferredBindings: true,
  refresh: true,
  apply: applyNamespace(options),
  bind: async (resource, resources) => {
    const recorded = namespaceOwner(resource);
    const owner = Object.values(resources).find(
      (item) => item.definition.type === "cloudflare.worker" && item.physicalId === recorded.worker,
    );
    if (!owner) throw new Error("Durable Object owning Worker is missing.");
    await verifyWorker(owner, options);
    const matches = (await Effect.runPromise(options.client.list())).filter(
      (item) => item.script === recorded.worker && item.class === recorded.className,
    );
    if (matches.length !== 1 || !matches[0]?.id || matches[0].useSqlite !== true)
      throw new Error("Published Durable Object namespace could not be verified as SQLite.");
    if (recorded.namespaceId && recorded.namespaceId !== matches[0].id)
      throw new Error("Durable Object namespace identity changed during publication.");
    return { ...objectProperties(resource.outputs), namespaceId: matches[0].id };
  },
  remove: async (resource, resources = {}) => {
    const recorded = namespaceOwner(resource);
    const exists = () =>
      options.client.list().pipe(
        Effect.map((items) =>
          items.some((item) => {
            if (item.script !== recorded.worker || item.class !== recorded.className) return false;
            if (!recorded.namespaceId || item.id !== recorded.namespaceId)
              throw new Error(
                "Namespace retirement cannot remove an unverified or replaced namespace.",
              );
            return true;
          }),
        ),
      );
    if (!(await Effect.runPromise(exists()))) return;
    const owner = Object.values(resources).find(
      (item) => item.definition.type === "cloudflare.worker" && item.physicalId === recorded.worker,
    );
    if (!owner) throw new Error("Cannot retire a namespace without its owned Worker.");
    await retireOwner(owner, resources, options);
    if (await Effect.runPromise(exists()))
      throw new Error("Durable Object namespace is still present after retirement.");
  },
});
