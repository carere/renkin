import { Effect } from "effect";
import { validateName } from "#src/contexts/root/models/stack.ts";
import {
  StateError,
  type StateRepository,
} from "#src/contexts/root/services/state/state-repository.ts";

const validate = (...names: string[]) =>
  Effect.try({
    try: () => names.forEach(validateName),
    catch: () => new StateError("invalid", "Invalid stack or environment name."),
  });
export const listEnvironments = (state: StateRepository, stack: string) =>
  validate(stack).pipe(Effect.andThen(() => state.list(stack)));

export const readOutputs = (
  state: StateRepository,
  stack: string,
  environment: string,
  options?: { readonly revealSecrets?: boolean },
) =>
  Effect.gen(function* () {
    yield* validate(stack, environment);
    const current = yield* state.read(stack, environment);
    if (!current) return undefined;
    return Object.fromEntries(
      Object.entries(current.outputs).map(([key, output]) => [
        key,
        output.secret && !options?.revealSecrets ? "[REDACTED]" : output.value,
      ]),
    );
  });
