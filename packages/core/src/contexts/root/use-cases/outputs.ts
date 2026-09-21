import { Effect } from "effect";
import { validateName } from "../models/stack.ts";
import type { StateRepository } from "../services/state/state-repository.ts";
import { StateError } from "../services/state/state-repository.ts";

export const listEnvironments = (state: StateRepository, stack: string) =>
  Effect.tryPromise({
    try: () => {
      validateName(stack);
      return state.list(stack);
    },
    catch: () => new StateError("unreadable", "Could not list environments."),
  });

export const readOutputs = (
  state: StateRepository,
  stack: string,
  environment: string,
  options?: { readonly revealSecrets?: boolean },
) =>
  Effect.tryPromise({
    try: async () => {
      validateName(stack);
      validateName(environment);
      const current = await state.read(stack, environment);
      if (!current) return undefined;
      return Object.fromEntries(
        Object.entries(current.outputs).map(([key, output]) => [
          key,
          output.secret && !options?.revealSecrets ? "[REDACTED]" : output.value,
        ]),
      );
    },
    catch: () => new StateError("unreadable", "Could not read environment outputs."),
  });
