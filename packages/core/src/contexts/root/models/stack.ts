export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export interface ResourceDefinition {
  readonly id: string;
  readonly type: string;
  /** Changes to this key require replacement, not an in-place update. */
  readonly identity: string;
  readonly properties: Json;
  readonly dependencies?: readonly string[];
  readonly protection?: { readonly data: boolean; readonly allowDelete: boolean };
  readonly retain?: boolean;
}

export interface Output {
  readonly value: Json;
  readonly secret?: boolean;
}

export interface Stack {
  readonly name: string;
  readonly resources: readonly ResourceDefinition[];
  readonly outputs?: Readonly<Record<string, Output>>;
}

export const validateName = (name: string): void => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new Error("Names must contain 1–64 letters, numbers, underscores or hyphens.");
  }
};

export const defineStack = (stack: Stack): Stack => {
  validateName(stack.name);
  const ids = new Set<string>();
  for (const resource of stack.resources) {
    validateName(resource.id);
    if (ids.has(resource.id)) throw new Error(`Duplicate resource ID: ${resource.id}`);
    ids.add(resource.id);
  }
  return stack;
};

export const output = (value: Json, options?: { readonly secret?: boolean }): Output => ({
  value,
  ...options,
});
