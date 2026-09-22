import { isDeepStrictEqual } from "node:util";
import { type ResourceDefinition, validateName } from "@renkin/core/models/stack";
import type { WorkerResource } from "#src/contexts/root/models/worker.ts";

/** Framework-owned resources use the same declarations and lifecycle as explicit resources. */
export const expandResources = (
  resources: readonly ResourceDefinition[],
): readonly ResourceDefinition[] => {
  const resolved = new Map<string, ResourceDefinition>();
  const pending = [...resources];
  for (let index = 0; index < pending.length; index++) {
    const resource = pending[index];
    if (!resource) continue;
    validateName(resource.id);
    const previous = resolved.get(resource.id);
    if (previous) {
      if (!isDeepStrictEqual(previous, resource))
        throw new Error(`Conflicting resource definitions: ${resource.id}`);
      continue;
    }
    resolved.set(resource.id, resource);
    if (resource.type === "cloudflare.worker" && "options" in resource)
      pending.push(...((resource as WorkerResource).options.dependencies ?? []));
  }
  return [...resolved.values()];
};
