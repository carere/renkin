import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const verifyTransportImports = async (serial: boolean) => {
  const result = await promisify(execFile)(
    "bun",
    [
      "--no-env-file",
      fileURLToPath(new URL("./imports-probe.ts", import.meta.url)),
      ...(serial ? ["--serial"] : []),
    ],
    { timeout: 10000 },
  );
  assert.equal(result.stdout.trim(), "Wrangler CJS and Miniflare ESM share initialized exports");
};
