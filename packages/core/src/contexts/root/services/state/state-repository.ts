import type { Effect } from "effect";
import type { EnvironmentState } from "#src/contexts/root/models/state.ts";

export interface StateLease {
  /** Authoritative fencing token, when the repository routes remote mutations. */
  readonly token: string;
  read(): Effect.Effect<EnvironmentState | undefined, StateError>;
  write(state: EnvironmentState): Effect.Effect<void, StateError>;
  /** Remove only an empty environment record under this lease, then invalidate the lease. */
  removeEmpty(): Effect.Effect<void, StateError>;
  release(): Effect.Effect<void, StateError>;
}

export interface StateRepository {
  read(stack: string, environment: string): Effect.Effect<EnvironmentState | undefined, StateError>;
  list(stack: string): Effect.Effect<readonly string[], StateError>;
  acquire(stack: string, environment: string): Effect.Effect<StateLease, StateError>;
}

/** Deliberately omits underlying causes: provider errors can contain secrets. */
export class StateError extends Error {
  readonly name = "StateError";
  constructor(
    readonly kind: "busy" | "unreadable" | "unauthorized" | "decrypt" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
