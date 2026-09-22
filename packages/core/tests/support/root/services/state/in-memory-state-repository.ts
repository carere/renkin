import { Effect } from "effect";
import type { EnvironmentState } from "#src/contexts/root/models/state.ts";
import {
  StateError,
  type StateLease,
  type StateRepository,
} from "#src/contexts/root/services/state/state-repository.ts";
export class InMemoryStateRepository implements StateRepository {
  value: EnvironmentState | undefined;
  written: EnvironmentState | undefined;
  removeEmptyCalls = 0;
  releaseCalls = 0;
  removeEmptyError: Error | undefined;
  read() {
    return Effect.sync(() => this.value);
  }
  list() {
    return Effect.sync(() => (this.value ? [this.value.environment] : []));
  }
  acquire(): Effect.Effect<StateLease> {
    return Effect.sync(() => ({
      token: "test",
      read: () => this.read(),
      write: (state) =>
        Effect.sync(() => {
          this.written = structuredClone(state);
        }),
      removeEmpty: () =>
        Effect.suspend(() => {
          this.removeEmptyCalls++;
          return this.removeEmptyError
            ? Effect.fail(new StateError("unreadable", this.removeEmptyError.message))
            : Effect.void;
        }),
      release: () =>
        Effect.sync(() => {
          this.releaseCalls++;
        }),
    }));
  }
}
