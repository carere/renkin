import { defineDurableObject as implementation } from "@renkin/runtime/models/durable-object-implementation";
export const defineDurableObject = implementation;

import type {
  DurableObjectState as State,
  DurableObjectStorage as Storage,
} from "@renkin/runtime/models/durable-object";
export type DurableObjectState = State;
export type DurableObjectStorage = Storage;
