import type { Json, Output, ResourceDefinition } from "./stack.ts";
import type { ResourceState } from "./state.ts";

/** A name, never a credential value. Resolution happens at the runtime boundary. */
export type Secret = { readonly $renkin: "secret"; readonly environment: string };
export const secret = (environment: string): Secret => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(environment))
    throw new Error("Secret environment variable name is invalid.");
  return { $renkin: "secret", environment };
};

export type ResourceOutput<T extends Json = Json> = {
  readonly $renkin: "output";
  readonly resource: string;
  readonly resourceType: string;
  readonly key: string;
  readonly secret: boolean;
  readonly local?: T;
  /** Type-only result marker. */
  readonly valueType?: T;
};

export const resourceOutput = <
  O extends Readonly<Record<string, Json>>,
  K extends keyof O & string,
>(
  resource: ResourceDefinition<O>,
  key: K,
  options?: { readonly local?: O[K] },
): ResourceOutput<O[K]> => ({
  $renkin: "output",
  resource: resource.id,
  resourceType: resource.type,
  key,
  secret: resource.secretOutputs ?? false,
  ...options,
});

export type TextBinding = string | Secret | ResourceOutput<string>;
export const isResourceOutput = (value: Json): value is ResourceOutput =>
  !!value && typeof value === "object" && "$renkin" in value && value.$renkin === "output";
export const isSecret = (value: Json): value is Secret =>
  !!value && typeof value === "object" && "$renkin" in value && value.$renkin === "secret";

export const outputReferences = (value: Json): readonly ResourceOutput[] => {
  if (isResourceOutput(value)) return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(outputReferences);
};

/** Resolve nested stack outputs and keep secret classification even through aliases. */
export const resolveValue = (
  value: Json,
  resources: Readonly<Record<string, ResourceState>>,
  local = false,
): Output => {
  if (isSecret(value)) {
    const text = process.env[value.environment];
    if (text === undefined || text === "")
      throw new Error("Required secret environment variable is missing.");
    return { value: text, secret: true };
  }
  if (isResourceOutput(value)) {
    if (local) {
      if (value.local === undefined)
        throw new Error("Resource output requires an explicit local value.");
      return { value: value.local, secret: value.secret };
    }
    const target = resources[value.resource];
    const outputs = target?.outputs;
    if (
      !target ||
      target.definition.type !== value.resourceType ||
      !outputs ||
      typeof outputs !== "object" ||
      Array.isArray(outputs) ||
      !Object.hasOwn(outputs, value.key)
    )
      throw new Error("Referenced resource output is unavailable.");
    return {
      value: (outputs as Readonly<Record<string, Json>>)[value.key] as Json,
      secret: value.secret || (target.definition.secretOutputs ?? false),
    };
  }
  if (!value || typeof value !== "object") return { value };
  const entries = Object.entries(value).map(
    ([key, item]) => [key, resolveValue(item, resources, local)] as const,
  );
  return {
    value: Array.isArray(value)
      ? entries.map(([, item]) => item.value)
      : Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
    secret: entries.some(([, item]) => item.secret),
  };
};

export const resolveTextBinding = (
  value: Json,
  resources: Readonly<Record<string, ResourceState>>,
  local = false,
) => {
  if (typeof value !== "string" && !isSecret(value) && !isResourceOutput(value))
    throw new Error("Invalid text binding.");
  const resolved = resolveValue(value, resources, local);
  if (typeof resolved.value !== "string") throw new Error("Text binding output must be a string.");
  return { text: resolved.value, secret: resolved.secret ?? false };
};
