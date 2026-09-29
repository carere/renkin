import { expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { startupFailure } from "#src/contexts/root/services/development/startup-diagnostic.ts";

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

it("keeps only runtime-reported compatibility dates and upgrade guidance", () => {
  const error = new Error(
    'SECRET_STDERR This Worker requires compatibility date "2026-09-08", but the newest date supported by this server binary is "2026-08-06". SECRET_BINDING',
  );
  const result = startupFailure("start-runtime", new Error("SECRET_WRAPPER", { cause: error }));
  expect(result.message).toContain("2026-09-08");
  expect(result.message).toContain("2026-08-06");
  expect(result.message).toContain("Upgrade @carere/renkin");
  expect(result.message).not.toContain("SECRET_");
  expect(result.cause).toBeUndefined();
});
