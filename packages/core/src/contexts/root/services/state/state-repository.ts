import type { EnvironmentState } from "#src/contexts/root/models/state.ts";

export interface StateLease {
  /** Authoritative fencing token, when the repository routes remote mutations. */
  readonly token: string;
  read(): Promise<EnvironmentState | undefined>;
  write(state: EnvironmentState): Promise<void>;
  /** Remove only an empty environment record under this lease, then invalidate the lease. */
  removeEmpty(): Promise<void>;
  release(): Promise<void>;
}

export interface StateRepository {
  read(stack: string, environment: string): Promise<EnvironmentState | undefined>;
  list(stack: string): Promise<readonly string[]>;
  acquire(stack: string, environment: string): Promise<StateLease>;
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
