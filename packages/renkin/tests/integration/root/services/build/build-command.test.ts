import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";

it("runs Moon through the public external builder without recursive output-lock contention", async () => {
  const script = new URL("../../../../support/root/build/nesting-probe.ts", import.meta.url)
    .pathname;
  const result = await promisify(execFile)(
    process.versions.bun ? process.execPath : "bun",
    ["--no-env-file", script],
    { timeout: 60_000 },
  );
  expect(result.stdout.trim()).toBe(
    "Public Moon → Bun → buildAstro nesting and verified reuse passed.",
  );
}, 70_000);
