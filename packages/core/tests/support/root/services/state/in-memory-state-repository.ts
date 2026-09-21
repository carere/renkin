import type { EnvironmentState } from "#src/contexts/root/models/state.ts";
import type {
  StateLease,
  StateRepository,
} from "#src/contexts/root/services/state/state-repository.ts";

export class InMemoryStateRepository implements StateRepository {
  value: EnvironmentState | undefined;
  written: EnvironmentState | undefined;
  removeEmptyCalls = 0;
  removeEmptyError: Error | undefined;
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
        this.removeEmptyCalls++;
        if (this.removeEmptyError) throw this.removeEmptyError;
      },
      release: async () => {},
    };
  }
}
