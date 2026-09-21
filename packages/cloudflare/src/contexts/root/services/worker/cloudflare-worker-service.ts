import { createHash } from "node:crypto";
import type {
  createCloudflareClient,
  WorkerUpload,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { canonical } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
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
const bindings = (
  definition: ResourceDefinition,
  resources: Readonly<Record<string, ResourceState>>,
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
    } else if (requirement.type === "cloudflare.worker-reference") {
      const external = requirement.external ? object(requirement.external) : undefined;
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
  readonly siteClient: ReturnType<typeof createSiteClient>;
  readonly token: string;
  readonly stack: string;
  readonly environment: string;
  readonly subdomain: string;
}

const publishWorker = async (
  options: WorkerServiceOptions,
  resource: ResourceState,
  resources: Readonly<Record<string, ResourceState>>,
  marker: string,
  tags: readonly string[],
) => {
  const resolved = bindings(resource.definition, resources);
  const hash = createHash("sha256")
    .update(canonical(resource.definition.properties))
    .update(JSON.stringify(resolved))
    .digest("hex");
  if (!tags.includes(`renkin-config:${hash}`)) {
    const publication = await prepareWorkerPublication(resource, options.siteClient, options.token);
    await Effect.runPromise(
      options.client.putWorker(
        {
          scriptName: resource.physicalId,
          metadata: {
            ...input(resource.definition),
            ...publication.metadata,
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

export const cloudflareWorkerService = (options: WorkerServiceOptions): ResourceService => {
  const marker = (id: string) => `renkin:${options.stack}:${options.environment}:${id}`;
  const verifyOwner = async (name: string, ownershipId: string) => {
    const existing = await Effect.runPromise(
      options.client
        .getWorker(name)
        .pipe(Effect.catchTag("WorkerNotFound", () => Effect.succeed(undefined))),
    );
    if (
      existing &&
      !existing.tags?.some((tag) => tag === marker(name) || tag === marker(ownershipId))
    )
      throw new Error("Worker ownership does not match this environment.");
    return existing;
  };
  return {
    deferredBindings: true,
    refresh: true,
    apply: async (definition, physicalId, previous) => {
      const existing = await verifyOwner(
        physicalId,
        previous?.ownershipId ?? previous?.definition.id ?? definition.id,
      );
      if (!existing)
        await Effect.runPromise(
          options.client.putWorker(
            {
              scriptName: physicalId,
              metadata: { ...input(definition), tags: [marker(physicalId)] },
              files: [
                new File([stub(definition)], "worker.mjs", {
                  type: "application/javascript+module",
                }),
              ],
            },
            options.token,
          ),
        );
      return { url: `https://${physicalId}.${options.subdomain}.workers.dev`, name: physicalId };
    },
    bind: async (resource, resources) => {
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
      );
      await finalizeWorkerPublication(resource, options.siteClient, options.token);
    },
    remove: async (resource) => {
      if (!(await verifyOwner(resource.physicalId, resource.ownershipId ?? resource.definition.id)))
        return;
      await Effect.runPromise(
        options.client
          .deleteWorker(resource.physicalId, options.token)
          .pipe(Effect.catchTag("WorkerNotFound", () => Effect.void)),
      );
    },
  };
};
