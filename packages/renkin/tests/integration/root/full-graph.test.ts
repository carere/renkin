import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";

it("runs the eight-application native/browser graph without credentials, profiles or provider networking", async () => {
  const { stdout } = await promisify(execFile)(
    process.versions.bun ? process.execPath : "bun",
    [
      "--no-env-file",
      fileURLToPath(new URL("../../support/root/full-graph/run.ts", import.meta.url)),
      "--network-denied",
    ],
    { timeout: 170000, maxBuffer: 300000 },
  );
  expect(stdout).toContain("external TCP denied");
  expect(stdout).toContain("DO SQLite/alarm passed");
  expect(stdout).toContain("frontend HMR/native reload passed");
  expect(stdout).toContain("did not resend email");
  expect(stdout).toContain("separate stack isolation and Review/Companion exclusion passed");
}, 180000);
