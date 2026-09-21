import { expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { startupFailure } from "../../../../src/contexts/root/services/development/startup-diagnostic.ts";

it("does not invoke a user stack getter while sanitizing startup failure", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const getter = vi.fn(() => {
    throw new Error("PRIVATE_GETTER");
  });
  try {
    const error = Object.defineProperty(new TypeError("PRIVATE_MESSAGE"), "stack", {
      get: getter,
    });
    expect(startupFailure("frameworks", error).cause).toEqual({
      phase: "frameworks",
      failures: [{ name: "TypeError" }],
    });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_");
  } finally {
    log.mockRestore();
  }
});
