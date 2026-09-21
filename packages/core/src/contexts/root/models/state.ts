import type { Json, Output, ResourceDefinition } from "./stack.ts";

export interface ResourceState {
  readonly definition: ResourceDefinition;
  readonly physicalId: string;
  readonly outputs: Json;
  /** Stable ownership proof across logical-ID renames. */
  readonly ownershipId?: string;
}

export type ChangeKind = "create" | "update" | "replace" | "remove" | "retain" | "unchanged";

export interface Change {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly desired?: ResourceDefinition;
  readonly previous?: ResourceState;
}

export interface PendingOperation {
  readonly change: Change;
  readonly physicalId: string;
  readonly phase: "apply" | "bindings" | "remove-previous" | "remove";
  readonly applied?: ResourceState;
}

export interface EnvironmentState {
  readonly version: 1;
  readonly stack: string;
  readonly environment: string;
  readonly resources: Record<string, ResourceState>;
  readonly outputs: Record<string, Output>;
  pending?: PendingOperation;
  bindings?: PendingOperation[];
}

export const emptyState = (stack: string, environment: string): EnvironmentState => ({
  version: 1,
  stack,
  environment,
  resources: {},
  outputs: {},
});

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const json = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (Array.isArray(value) ? value.every(json) : record(value) && Object.values(value).every(json));

const definition = (value: unknown): boolean =>
  record(value) &&
  typeof value.id === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.id) &&
  typeof value.type === "string" &&
  value.type.length > 0 &&
  typeof value.identity === "string" &&
  json(value.properties) &&
  (value.dependencies === undefined ||
    (Array.isArray(value.dependencies) &&
      value.dependencies.every((id) => typeof id === "string"))) &&
  (value.references === undefined ||
    (Array.isArray(value.references) && value.references.every((id) => typeof id === "string"))) &&
  (value.retain === undefined || typeof value.retain === "boolean") &&
  (value.protection === undefined ||
    (record(value.protection) &&
      typeof value.protection.data === "boolean" &&
      typeof value.protection.allowDelete === "boolean"));

const resource = (value: unknown): boolean =>
  record(value) &&
  definition(value.definition) &&
  typeof value.physicalId === "string" &&
  value.physicalId.length > 0 &&
  json(value.outputs) &&
  (value.ownershipId === undefined || typeof value.ownershipId === "string");

const pending = (value: unknown): boolean => {
  if (
    !record(value) ||
    !record(value.change) ||
    typeof value.physicalId !== "string" ||
    value.physicalId.length === 0
  )
    return false;
  const change = value.change;
  if (
    typeof change.id !== "string" ||
    !["create", "update", "replace", "remove"].includes(String(change.kind))
  )
    return false;
  if (change.kind !== "remove" && !definition(change.desired)) return false;
  if (change.kind !== "create" && !resource(change.previous)) return false;
  if (record(change.desired) && change.desired.id !== change.id) return false;
  if (
    record(change.previous) &&
    record(change.previous.definition) &&
    change.previous.definition.id !== change.id
  )
    return false;
  if (change.kind === "remove") return value.phase === "remove";
  if (!["apply", "bindings", "remove-previous"].includes(String(value.phase))) return false;
  if (value.phase !== "apply" && !resource(value.applied)) return false;
  if (
    value.applied !== undefined &&
    (!resource(value.applied) ||
      !record(value.applied) ||
      value.applied.physicalId !== value.physicalId ||
      !record(value.applied.definition) ||
      !record(change.desired) ||
      JSON.stringify(value.applied.definition) !== JSON.stringify(change.desired))
  )
    return false;
  return true;
};

/** A corrupt checkpoint is never interpreted as a fresh environment or completed operation. */
export const decodeState = (text: string, stack: string, environment: string): EnvironmentState => {
  const value: unknown = JSON.parse(text);
  if (
    !record(value) ||
    value.version !== 1 ||
    value.stack !== stack ||
    value.environment !== environment ||
    !record(value.resources) ||
    !record(value.outputs)
  ) {
    throw new Error("State is invalid or belongs to another environment.");
  }
  if (
    !Object.entries(value.resources).every(
      ([id, item]) =>
        resource(item) && record(item) && record(item.definition) && item.definition.id === id,
    ) ||
    !Object.values(value.outputs).every(
      (item) =>
        record(item) &&
        json(item.value) &&
        (item.secret === undefined || typeof item.secret === "boolean"),
    ) ||
    (value.pending !== undefined && !pending(value.pending)) ||
    (value.bindings !== undefined &&
      (!Array.isArray(value.bindings) ||
        !value.bindings.every(
          (op) => pending(op) && record(op) && op.phase !== "apply" && op.phase !== "remove",
        )))
  ) {
    throw new Error("State contains an invalid resource, output or operation record.");
  }
  return value as unknown as EnvironmentState;
};
