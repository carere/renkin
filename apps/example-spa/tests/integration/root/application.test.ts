import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "@effect/vitest";

it("hydrates, navigates, reloads and runs the built app through public Bun APIs", async () => {
  await promisify(execFile)(
    process.versions.bun ? process.execPath : "bun",
    ["--no-env-file", fileURLToPath(new URL("../../support/application.ts", import.meta.url))],
    { timeout: 110_000, maxBuffer: 100_000 },
  );
}, 120_000);
