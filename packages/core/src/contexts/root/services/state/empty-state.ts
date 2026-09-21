import type { EnvironmentState } from "../../models/state.ts";
import { StateError } from "./state-repository.ts";

/** Removal is terminal for a lease and never discards unfinished work or owned resources. */
export const assertEmptyState = (state: EnvironmentState | undefined): void => {
  if (
    state &&
    (Object.keys(state.resources).length ||
      state.pending ||
      state.bindings?.length ||
      Object.keys(state.outputs).length)
  )
    throw new StateError(
      "invalid",
      "Environment still has resources, outputs or unfinished operations.",
    );
};
