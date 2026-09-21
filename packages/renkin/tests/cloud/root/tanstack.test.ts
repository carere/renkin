import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";

it.each(["spa", "ssr"])(
  "deploys and cleans the public Solid %s example",
  async (mode) => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.versions.bun ? process.execPath : "bun",
        [
          "--no-env-file",
          fileURLToPath(new URL("../../support/root/tanstack-cloud.ts", import.meta.url)),
          mode,
        ],
        { stdio: "inherit", env: process.env },
      );
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`Cloud ${mode} scenario failed (${code}).`)),
      );
    });
  },
  420_000,
);
