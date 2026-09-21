import type { Json, ResourceDefinition, Stack } from "../models/stack.ts";
import type { Change, EnvironmentState } from "../models/state.ts";
import { renamedState } from "./rename.ts";

export const canonical = (value: Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const ordered = (resources: readonly ResourceDefinition[]): readonly ResourceDefinition[] => {
  const result: ResourceDefinition[] = [];
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const visit = (resource: ResourceDefinition): void => {
    if (complete.has(resource.id)) return;
    if (visiting.has(resource.id)) throw new Error(`Dependency cycle at ${resource.id}`);
    visiting.add(resource.id);
    for (const id of resource.dependencies ?? []) {
      const dependency = resources.find((item) => item.id === id);
      if (!dependency) throw new Error(`Unknown dependency ${id}`);
      visit(dependency);
    }
    visiting.delete(resource.id);
    complete.add(resource.id);
    result.push(resource);
  };
  resources.forEach(visit);
  return result;
};

export const plan = (stack: Stack, state: EnvironmentState, force = false): readonly Change[] => {
  state = renamedState(stack, state);
  for (const resource of stack.resources) {
    for (const id of resource.references ?? []) {
      if (!stack.resources.some((target) => target.id === id))
        throw new Error(`Unknown binding reference ${id}`);
    }
  }
  const changes: Change[] = ordered(stack.resources).map((desired) => {
    const previous = Object.hasOwn(state.resources, desired.id)
      ? state.resources[desired.id]
      : undefined;
    const kind = !previous
      ? "create"
      : previous.definition.type !== desired.type ||
          previous.definition.identity !== desired.identity
        ? "replace"
        : force || canonical(previous.definition.properties) !== canonical(desired.properties)
          ? "update"
          : "unchanged";
    return { id: desired.id, kind, desired, ...(previous ? { previous } : {}) };
  });
  const removed = Object.values(state.resources).filter(
    (item) => !stack.resources.some((r) => r.id === item.definition.id),
  );
  for (const resource of ordered(
    removed.map((item) => ({
      ...item.definition,
      dependencies:
        item.definition.dependencies?.filter((id) => removed.some((r) => r.definition.id === id)) ??
        [],
    })),
  ).toReversed()) {
    const previous = state.resources[resource.id];
    if (previous)
      changes.push({ id: resource.id, kind: resource.retain ? "retain" : "remove", previous });
  }
  assertProtection(changes);
  return changes;
};

export const assertProtection = (changes: readonly Change[]): void => {
  for (const change of changes) {
    if (change.kind !== "remove" && change.kind !== "replace") continue;
    const settings = change.desired?.protection ?? change.previous?.definition.protection;
    if (change.previous?.definition.protection?.data && !settings?.allowDelete) {
      throw new Error(
        `Deletion protection blocks ${change.kind} of ${change.id}. Enable allowDelete on the resource explicitly.`,
      );
    }
  }
};
