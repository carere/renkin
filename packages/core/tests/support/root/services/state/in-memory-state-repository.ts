import type { EnvironmentState } from "../../../../../src/contexts/root/models/state.ts";
import { assertEmptyState } from "../../../../../src/contexts/root/services/state/empty-state.ts";
import type {
  StateLease,
  StateRepository,
} from "../../../../../src/contexts/root/services/state/state-repository.ts";

export class InMemoryStateRepository implements StateRepository {
  value: EnvironmentState | undefined;
  written: EnvironmentState | undefined;
  async read() {
    return this.value;
  }
  async list() {
    return this.value ? [this.value.environment] : [];
  }
  async acquire(): Promise<StateLease> {
    return {
      token: "test",
      read: () => this.read(),
      write: async (state) => {
        this.written = structuredClone(state);
      },
      removeEmpty: async () => {
        assertEmptyState(this.written ?? this.value);
        this.value = undefined;
        this.written = undefined;
      },
      release: async () => {},
    };
  }
}
