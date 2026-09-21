import type { Json } from "@renkin/core/models/stack";
export const backgroundProperties = (value: Json | undefined): Readonly<Record<string, Json>> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid background resource properties.");
  return value as Readonly<Record<string, Json>>;
};
export const stringProperty = (value: Json | undefined, property: string): string => {
  const result = backgroundProperties(value)[property];
  if (typeof result !== "string" || !result)
    throw new Error(`Background resource has no ${property}.`);
  return result;
};
