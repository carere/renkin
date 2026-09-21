import { createHash } from "node:crypto";
import type { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import type {
  createCloudflareClient,
  WorkerUpload,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { createDurableObjectClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/durable-object-client";
import type { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { canonical } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
import {
  assertNoDurableObjects,
  durableObjectMetadata,
  observedDurableObjectClasses,
  prepareDurableObjectLedger,
} from "../durable-object/worker-durable-objects.ts";
import { backgroundBinding } from "./background-bindings.ts";
import {
  assertNoOwnedWorkflows,
  backgroundOutputs,
  reconcileWorkerBackground,
} from "./worker-background.ts";
import { finalizeWorkerPublication, prepareWorkerPublication } from "./worker-publication.ts";

type Metadata = NonNullable<WorkerUpload["metadata"]>;
const object = (value: Json): Readonly<Record<string, Json>> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Worker properties.");
  return value as Readonly<Record<string, Json>>;
};
const input = (definition: ResourceDefinition): Metadata => {
  const value = object(definition.properties);
  if (typeof value.source !== "string" || typeof value.compatibilityDate !== "string")
    throw new Error("Worker must be bundled before deployment.");
  const flags = value.compatibilityFlags;
  if (!Array.isArray(flags) || !flags.every((flag) => typeof flag === "string"))
    throw new Error("Invalid compatibility flags.");
  return {
    mainModule: "worker.mjs",
    compatibilityDate: value.compatibilityDate,
    compatibilityFlags: flags,
  };
};
const credentialBinding = (
  target: ResourceState | undefined,
  name: string,
): NonNullable<Metadata["bindings"]>[number] => {
  if (target?.definition.type !== "cloudflare.r2-token" || !target.definition.secretOutputs)
    throw new Error("R2 credential binding target is not provisioned.");
  const { accessKeyId, secretAccessKey, endpoint, region, buckets } = object(target.outputs);
  if (
    typeof accessKeyId !== "string" ||
    typeof secretAccessKey !== "string" ||
    typeof endpoint !== "string" ||
    region !== "auto" ||
    !buckets
  )
    throw new Error("R2 credential binding is incomplete.");
  return {
    type: "secret_text",
    name,
    text: JSON.stringify({ accessKeyId, secretAccessKey, endpoint, region, buckets }),
  };
};

const bindings = (
  definition: ResourceDefinition,
  resources: Readonly<Record<string, ResourceState>>,
  ignoreRemovedWorkers = false,
): NonNullable<Metadata["bindings"]> => {
  const properties = object(definition.properties);
  const result: NonNullable<Metadata["bindings"]> = Object.entries(
    object(properties.bindings ?? {}),
  ).map(([name, text]) => {
    if (typeof text !== "string") throw new Error("Text bindings must be strings.");
    return { type: "plain_text", name, text };
  });
  for (const [name, value] of Object.entries(object(properties.requirements ?? {}))) {
    if (result.some((item) => item.name === name))
      throw new Error("Duplicate Worker binding name.");
    const requirement = object(value);
    const target = typeof requirement.id === "string" ? resources[requirement.id] : undefined;
    if (requirement.type === "cloudflare.kv") {
      if (target?.definition.type !== "cloudflare.kv")
        throw new Error("KV binding target is not provisioned.");
      result.push({ type: "kv_namespace", name, namespaceId: target.physicalId });
    } else if (requirement.type === "cloudflare.d1") {
      if (target?.definition.type !== "cloudflare.d1")
        throw new Error("D1 binding target is not provisioned.");
      result.push({ type: "d1", name, databaseId: target.physicalId });
    } else if (requirement.type === "cloudflare.durable-object") {
      if (target?.definition.type !== "cloudflare.durable-object")
        throw new Error("Durable Object binding target is not provisioned.");
      const owned = object(target.outputs);
      if (typeof owned.worker !== "string" || typeof owned.className !== "string")
        throw new Error("Durable Object ownership checkpoint is missing.");
      result.push({
        type: "durable_object_namespace",
        name,
        scriptName: owned.worker,
        className: owned.className,
      });
    } else if (requirement.type === "cloudflare.r2-token") {
      result.push(credentialBinding(target, name));
    } else if (requirement.type === "cloudflare.r2") {
      if (target?.definition.type !== "cloudflare.r2")
        throw new Error("R2 binding target is not provisioned.");
      const jurisdiction = object(target.definition.properties).jurisdiction;
      result.push({
        type: "r2_bucket",
        name,
        bucketName: target.physicalId,
        ...(typeof jurisdiction === "string" && jurisdiction !== "default" ? { jurisdiction } : {}),
      });
    } else if (
      ["cloudflare.queue", "cloudflare.workflow", "cloudflare.email"].includes(
        String(requirement.type),
      )
    ) {
      result.push(backgroundBinding(name, requirement, target));
    } else if (requirement.type === "cloudflare.worker-reference") {
      const external = requirement.external ? object(requirement.external) : undefined;
      if (!external && !target && ignoreRemovedWorkers) continue;
      const service = external?.name ?? target?.physicalId;
      if (
        typeof service !== "string" ||
        (!external && target?.definition.type !== "cloudflare.worker")
      )
        throw new Error("Worker binding target is not provisioned.");
      result.push({
        type: "service",
        name,
        service,
        ...(typeof requirement.entrypoint === "string"
          ? { entrypoint: requirement.entrypoint }
          : {}),
      });
    } else throw new Error("Unsupported Worker requirement.");
  }
  return result;
};
const stub = (definition: ResourceDefinition) => {
  const names = object(definition.properties).entrypoints;
  if (
    names !== undefined &&
    (!Array.isArray(names) ||
      !names.every((name) => typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)))
  )
    throw new Error("Invalid named entrypoints.");
  return `import {WorkerEntrypoint} from "cloudflare:workers"; ${(Array.isArray(names) ? names : []).map((name) => `export class ${name} extends WorkerEntrypoint {}`).join("\n")}\nexport default {fetch(){return new Response("Deployment is not ready",{status:503})}};`;
};

interface WorkerServiceOptions {
  readonly client: ReturnType<typeof createCloudflareClient>;
  readonly backgroundClient?: ReturnType<typeof createBackgroundClient>;
  readonly siteClient: ReturnType<typeof createSiteClient>;
  readonly durableObjectClient?: ReturnType<typeof createDurableObjectClient>;
  readonly desired?: readonly ResourceDefinition[];
  readonly token: string;
  readonly stack: string;
  readonly environment: string;
  readonly subdomain: string;
}

const configurationHash = (
  definition: ResourceDefinition,
  resolved: NonNullable<Metadata["bindings"]>,
) =>
  createHash("sha256")
    .update(canonical(definition.properties))
    .update(JSON.stringify(resolved))
    .digest("hex");

const publishWorker = async (
  options: WorkerServiceOptions,
  resource: ResourceState,
  resources: Readonly<Record<string, ResourceState>>,
  marker: string,
  tags: readonly string[],
  force = false,
) => {
  const resolved = bindings(resource.definition, resources);
  const hash = configurationHash(resource.definition, resolved);
  if (force || !tags.includes(`renkin-config:${hash}`)) {
    const publication = await prepareWorkerPublication(resource, options.siteClient, options.token);
    const classes = await observedDurableObjectClasses(
      resource.physicalId,
      options.durableObjectClient,
    );
    await Effect.runPromise(
      options.client.putWorker(
        {
          scriptName: resource.physicalId,
          metadata: {
            ...input(resource.definition),
            ...publication.metadata,
            ...durableObjectMetadata(resource, resources, classes),
            bindings: [...resolved, ...(publication.metadata.bindings ?? [])],
            tags: [marker, `renkin-config:${hash}`],
          },
          files: publication.files,
        },
        options.token,
      ),
    );
  }
};

const detachCallers = async (
  target: ResourceState,
  resources: Readonly<Record<string, ResourceState>>,
  options: WorkerServiceOptions,
  marker: (id: string) => string,
  verifyOwner: (
    name: string,
    ownershipId: string,
  ) => Promise<Awaited<ReturnType<typeof observeWorker>>>,
): Promise<void> => {
  for (const caller of Object.values(resources)) {
    if (caller.definition.type !== "cloudflare.worker") continue;
    const observed = await verifyOwner(
      caller.physicalId,
      caller.ownershipId ?? caller.definition.id,
    );
    if (
      !observed?.bindings?.some(
        (binding) => binding.type === "service" && binding.service === target.physicalId,
      )
    )
      continue;
    const expected = bindings(caller.definition, resources, true);
    const candidate = expected.map((binding) => {
      if (binding.type !== "service") return binding;
      const current = observed.bindings?.find((item) => item.name === binding.name);
      return current?.type === "service" && current.service === target.physicalId
        ? { ...binding, service: target.physicalId }
        : binding;
    });
    if (
      !observed.tags?.includes(`renkin-config:${configurationHash(caller.definition, candidate)}`)
    )
      throw new Error(
        "Owned caller configuration changed; reconcile it before removing its target.",
      );
    const publication = await prepareWorkerPublication(caller, options.siteClient, options.token);
    const classes = await observedDurableObjectClasses(
      caller.physicalId,
      options.durableObjectClient,
    );
    const resolved = expected.filter(
      (binding) => binding.type !== "service" || binding.service !== target.physicalId,
    );
    await Effect.runPromise(
      options.client.putWorker(
        {
          scriptName: caller.physicalId,
          metadata: {
            ...input(caller.definition),
            ...publication.metadata,
            ...durableObjectMetadata(caller, resources, classes),
            bindings: [...resolved, ...(publication.metadata.bindings ?? [])],
            tags: [
              marker(caller.physicalId),
              `renkin-config:${configurationHash(caller.definition, resolved)}`,
              `renkin-detached:${target.physicalId}`,
            ],
          },
          files: publication.files,
        },
        options.token,
      ),
    );
  }
};
const observeWorker = (options: WorkerServiceOptions, name: string) =>
  Effect.runPromise(
    options.client
      .getWorker(name)
      .pipe(Effect.catchTag("WorkerNotFound", () => Effect.succeed(undefined))),
  );

const workerOutputs = async (
  options: WorkerServiceOptions,
  definition: ResourceDefinition,
  physicalId: string,
  previous: ResourceState | undefined,
  resources: Readonly<Record<string, ResourceState>>,
) => ({
  url: `https://${physicalId}.${options.subdomain}.workers.dev`,
  name: physicalId,
  ...backgroundOutputs(definition, physicalId, previous, resources),
  ...(await prepareDurableObjectLedger(
    definition,
    previous,
    resources,
    options.desired ?? [],
    options.durableObjectClient,
  )),
});

const precreateWorker = async (
  options: WorkerServiceOptions,
  definition: ResourceDefinition,
  physicalId: string,
  ownershipMarker: string,
) => {
  await Effect.runPromise(
    options.client.putWorker(
      {
        scriptName: physicalId,
        metadata: { ...input(definition), tags: [ownershipMarker] },
        files: [
          new File([stub(definition)], "worker.mjs", { type: "application/javascript+module" }),
        ],
      },
      options.token,
    ),
  );
};

const workerOwnership =
  (options: WorkerServiceOptions, marker: (id: string) => string) =>
  async (name: string, ownershipId: string) => {
    const existing = await observeWorker(options, name);
    if (
      existing &&
      !existing.tags?.some((tag) => tag === marker(name) || tag === marker(ownershipId))
    )
      throw new Error("Worker ownership does not match this environment.");
    return existing;
  };

export const cloudflareWorkerService = (options: WorkerServiceOptions): ResourceService => {
  const marker = (id: string) => `renkin:${options.stack}:${options.environment}:${id}`;
  const verifyOwner = workerOwnership(options, marker);
  return {
    deferredBindings: true,
    refresh: true,
    apply: async (definition, physicalId, previous, resources = {}) => {
      const existing = await verifyOwner(
        physicalId,
        previous?.ownershipId ?? previous?.definition.id ?? definition.id,
      );
      if (!existing) await precreateWorker(options, definition, physicalId, marker(physicalId));
      return workerOutputs(options, definition, physicalId, previous, resources);
    },
    bind: async (resource, resources, _desired, operation) => {
      const current = await verifyOwner(
        resource.physicalId,
        resource.ownershipId ?? resource.definition.id,
      );
      await publishWorker(
        options,
        resource,
        resources,
        marker(resource.physicalId),
        current?.tags ?? [],
        operation?.force,
      );
      await finalizeWorkerPublication(resource, options.siteClient, options.token);
      await reconcileWorkerBackground(
        resource,
        resources,
        options.backgroundClient,
        options.token,
        (name) => verifyOwner(name, resource.ownershipId ?? resource.definition.id),
      );
    },
    remove: async (resource, resources = {}) => {
      if (!(await verifyOwner(resource.physicalId, resource.ownershipId ?? resource.definition.id)))
        return;
      await assertNoDurableObjects(resource.physicalId, options.durableObjectClient);
      await assertNoOwnedWorkflows(resource, options.backgroundClient);
      await reconcileWorkerBackground(
        resource,
        resources,
        options.backgroundClient,
        options.token,
        (name) => verifyOwner(name, resource.ownershipId ?? resource.definition.id),
        true,
      );
      await detachCallers(resource, resources, options, marker, verifyOwner);
      await Effect.runPromise(
        options.client
          .deleteWorker(resource.physicalId, options.token)
          .pipe(Effect.catchTag("WorkerNotFound", () => Effect.void)),
      );
    },
  };
};
