import { createHash } from "node:crypto";
import type { Stack } from "@renkin/core/models/stack";
import { bundleWorker } from "@renkin/runtime/services/bundler/worker-bundler";

/** Build before planning so source changes participate in the infrastructure diff. */
export const prepareStack = async (stack: Stack): Promise<Stack> => ({
  ...stack,
  resources: await Promise.all(
    stack.resources.map(async (resource) => {
      if (resource.type !== "cloudflare.worker") return resource;
      const properties = resource.properties;
      if (
        !properties ||
        typeof properties !== "object" ||
        Array.isArray(properties) ||
        !("entry" in properties) ||
        typeof properties.entry !== "string"
      ) {
        throw new Error("Worker entry must be a path.");
      }
      const bundle = await bundleWorker(properties.entry);
      return {
        ...resource,
        properties: {
          ...properties,
          source: bundle.code,
          sourceHash: createHash("sha256").update(bundle.code).digest("hex"),
        },
      };
    }),
  ),
});
