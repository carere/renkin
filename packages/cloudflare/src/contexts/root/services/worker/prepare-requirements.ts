import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import { inspectRequirements } from "@renkin/runtime/services/bundler/inspect-requirements";

export const prepareRequirements = async (
  resource: ResourceDefinition,
  source: string,
  compatibilityDate: string,
  compatibilityFlags: readonly string[],
  artifact?: {
    readonly mainModule: string;
    readonly modules: readonly {
      readonly name: string;
      readonly type: string;
      readonly content: string;
    }[];
  },
): Promise<ResourceDefinition> => {
  const requirements = await inspectRequirements(
    source,
    compatibilityDate,
    compatibilityFlags,
    artifact,
  );
  const dependencies = [
    ...new Set([
      ...(resource.dependencies ?? []),
      ...Object.values(requirements)
        .filter(
          (item) =>
            item.type === "cloudflare.kv" ||
            item.type === "cloudflare.d1" ||
            item.type === "cloudflare.queue",
        )
        .map((item) => item.id),
    ]),
  ];
  const references = [
    ...new Set(
      Object.values(requirements)
        .filter(
          (item) =>
            (item.type === "cloudflare.worker-reference" && !item.external) ||
            item.type === "cloudflare.workflow",
        )
        .map((item) => item.id),
    ),
  ];
  if (
    !resource.properties ||
    typeof resource.properties !== "object" ||
    Array.isArray(resource.properties)
  )
    throw new Error("Invalid Worker properties.");
  return {
    ...resource,
    dependencies,
    references,
    properties: { ...resource.properties, requirements: requirements as unknown as Json },
  };
};

/** Validate use sites and predeclare named entrypoints before any service binding is installed. */
export const finalizeRequirements = (
  resources: readonly ResourceDefinition[],
): readonly ResourceDefinition[] => {
  const entrypoints = new Map<string, Set<string>>();
  for (const resource of resources) {
    const properties = resource.properties;
    if (
      resource.type !== "cloudflare.worker" ||
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    )
      continue;
    const requirements = "requirements" in properties ? properties.requirements : undefined;
    if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) continue;
    for (const value of Object.values(requirements)) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("type" in value) ||
        !("id" in value) ||
        typeof value.id !== "string"
      )
        throw new Error("Invalid binding descriptor.");
      if ("external" in value && value.external) continue;
      if (value.type === "cloudflare.email") continue;
      const target = resources.find((item) => item.id === value.id);
      const expected =
        value.type === "cloudflare.worker-reference" ? "cloudflare.worker" : value.type;
      if (!target || target.type !== expected)
        throw new Error(`Binding target ${value.id} is missing or has another type.`);
      if (
        value.type === "cloudflare.worker-reference" &&
        "entrypoint" in value &&
        typeof value.entrypoint === "string"
      ) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.entrypoint) || value.entrypoint === "default")
          throw new Error("Invalid named Worker entrypoint.");
        const names = entrypoints.get(value.id) ?? new Set<string>();
        names.add(value.entrypoint);
        entrypoints.set(value.id, names);
      }
    }
  }
  return resources.map((resource) =>
    resource.type === "cloudflare.worker" &&
    resource.properties &&
    typeof resource.properties === "object" &&
    !Array.isArray(resource.properties)
      ? {
          ...resource,
          properties: {
            ...resource.properties,
            entrypoints: [...(entrypoints.get(resource.id) ?? [])].sort(),
          },
        }
      : resource,
  );
};
