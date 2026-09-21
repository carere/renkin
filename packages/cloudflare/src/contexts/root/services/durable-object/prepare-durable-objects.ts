import type { Json, ResourceDefinition } from "@renkin/core/models/stack";

export const objectProperties = (value: Json): Readonly<Record<string, Json>> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Durable Object properties.");
  return value as Readonly<Record<string, Json>>;
};
export const durableObjectProperties = (resource: ResourceDefinition) => {
  const value = objectProperties(resource.properties);
  if (
    typeof value.worker !== "string" ||
    typeof value.className !== "string" ||
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.className) ||
    value.className === "default"
  )
    throw new Error("Durable Object requires an owning Worker and named class export.");
  const renamedFrom = value.renamedFrom;
  if (
    renamedFrom != null &&
    (typeof renamedFrom !== "string" ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(renamedFrom) ||
      renamedFrom === "default" ||
      renamedFrom === value.className)
  )
    throw new Error("Durable Object class rename must identify a different named export.");
  return {
    worker: value.worker,
    className: value.className,
    ...(typeof renamedFrom === "string" ? { renamedFrom } : {}),
  };
};

/** Namespace ownership protects the owning Worker even before any object stores data. */
export const prepareDurableObjects = (
  resources: readonly ResourceDefinition[],
): readonly ResourceDefinition[] => {
  const owners = new Map<string, string[]>();
  const renames = new Map<string, Record<string, string>>();
  for (const resource of resources) {
    if (resource.type !== "cloudflare.durable-object") continue;
    const { worker, className, renamedFrom } = durableObjectProperties(resource);
    if (!resources.some((item) => item.id === worker && item.type === "cloudflare.worker"))
      throw new Error(`Durable Object ${resource.id} has no owning Worker.`);
    const names = owners.get(worker) ?? [];
    if (names.includes(className))
      throw new Error("Durable Object classes cannot have two owners.");
    names.push(className);
    owners.set(worker, names);
    if (renamedFrom) {
      const moves = renames.get(worker) ?? {};
      if (moves[renamedFrom]) throw new Error("Durable Object class rename source is duplicated.");
      moves[renamedFrom] = className;
      renames.set(worker, moves);
    }
  }
  return resources.map((resource) => {
    if (resource.type !== "cloudflare.worker") return resource;
    const properties = objectProperties(resource.properties);
    const dependencies = new Set(resource.dependencies ?? []);
    const references = new Set(resource.references ?? []);
    for (const value of Object.values(objectProperties(properties.requirements ?? {}))) {
      const requirement = objectProperties(value);
      if (requirement.type !== "cloudflare.durable-object") continue;
      const target = resources.find((item) => item.id === requirement.id);
      if (target?.type !== "cloudflare.durable-object")
        throw new Error("Durable Object binding target is missing.");
      const owner = durableObjectProperties(target).worker;
      (owner === resource.id ? references : dependencies).add(target.id);
    }
    return {
      ...resource,
      dependencies: [...dependencies],
      references: [...references],
      ...(owners.has(resource.id)
        ? { protection: { data: true, allowDelete: resource.protection?.allowDelete ?? false } }
        : {}),
      properties: {
        ...properties,
        durableObjectClasses: (owners.get(resource.id) ?? []).sort(),
        durableObjectRenames: renames.get(resource.id) ?? {},
      },
    };
  });
};
