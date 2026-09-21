import { expect, it } from "@effect/vitest";
import { decodeState, emptyState } from "../../../src/contexts/root/models/state.ts";

it("rejects invalid pending operations and outputs rather than forgetting ownership", () => {
  for (const invalid of [
    { pending: { phase: "unknown", physicalId: "owned", change: { id: "api", kind: "create" } } },
    { outputs: { secret: { value: "password", secret: "true" } } },
    { resources: [] },
    {
      pending: {
        phase: "bindings",
        physicalId: "owned",
        change: {
          id: "api",
          kind: "create",
          desired: { id: "api", type: "worker", identity: "api", properties: {} },
        },
      },
    },
  ]) {
    expect(() =>
      decodeState(JSON.stringify({ ...emptyState("app", "dev"), ...invalid }), "app", "dev"),
    ).toThrow();
  }
});
