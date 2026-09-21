import { createHash } from "node:crypto";
import type {
  createCloudflareClient,
  WorkerUpload,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";

const input = (definition: ResourceDefinition): WorkerUpload["metadata"] & { source: string } => {
  const value = definition.properties;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("source" in value) ||
    typeof value.source !== "string" ||
    typeof value.compatibilityDate !== "string"
  ) {
    throw new Error("Worker must be bundled before deployment.");
  }
  const flags = value.compatibilityFlags;
  if (!Array.isArray(flags) || !flags.every((flag) => typeof flag === "string"))
    throw new Error("Invalid compatibility flags.");
  const bindings = value.bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings))
    throw new Error("Invalid Worker bindings.");
  return {
    source: value.source,
    mainModule: "worker.mjs",
    compatibilityDate: value.compatibilityDate,
    compatibilityFlags: flags,
    bindings: Object.entries(bindings).map(([name, text]) => {
      if (typeof text !== "string") throw new Error("Text bindings must be strings.");
      return { type: "plain_text" as const, name, text };
    }),
  };
};

export const cloudflareWorkerService = (options: {
  readonly client: ReturnType<typeof createCloudflareClient>;
  readonly token: string;
  readonly stack: string;
  readonly environment: string;
  readonly subdomain: string;
}): ResourceService => {
  const marker = (id: string) => `renkin:${options.stack}:${options.environment}:${id}`;
  const observe = (name: string) =>
    Effect.runPromise(
      options.client
        .getWorker(name)
        .pipe(Effect.catchTag("WorkerNotFound", () => Effect.succeed(undefined))),
    );
  const verifyOwner = async (physicalId: string, id: string) => {
    const existing = await observe(physicalId);
    if (existing && !existing.tags?.includes(marker(id)))
      throw new Error("Worker ownership does not match this environment.");
    return existing;
  };
  return {
    apply: async (definition, physicalId) => {
      await verifyOwner(physicalId, definition.id);
      const { source, ...metadata } = input(definition);
      await Effect.runPromise(
        options.client.putWorker(
          {
            scriptName: physicalId,
            metadata: {
              ...metadata,
              tags: [
                marker(definition.id),
                `renkin-source:${createHash("sha256").update(source).digest("hex")}`,
              ],
            },
            files: [new File([source], "worker.mjs", { type: "application/javascript+module" })],
          },
          options.token,
        ),
      );
      return { url: `https://${physicalId}.${options.subdomain}.workers.dev`, name: physicalId };
    },
    bind: async (resource) => {
      await Effect.runPromise(
        options.client.enableWorkerSubdomain(resource.physicalId, options.token),
      );
    },
    remove: async (resource: ResourceState) => {
      if (!(await verifyOwner(resource.physicalId, resource.definition.id))) return;
      await Effect.runPromise(
        options.client
          .deleteWorker(resource.physicalId, options.token)
          .pipe(Effect.catchTag("WorkerNotFound", () => Effect.void)),
      );
    },
  };
};
