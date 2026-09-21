import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";

it("uses the real dispatcher only inside the official build runtime", async () => {
  const result = await promisify(execFile)(
    "bun",
    [fileURLToPath(new URL("../../../../support/root/build-transport/probe.ts", import.meta.url))],
    { timeout: 20000 },
  );
  expect(result.stdout).toContain(
    "real dispatcher, original URL, workerd and import identity verified",
  );
}, 30000);

// This negative control demonstrates the Bun shim really bypasses the required dispatcher.
it("detects the native Bun shim's missing dispatcher support", async () => {
  await expect(
    promisify(execFile)(
      "bun",
      [
        fileURLToPath(
          new URL("../../../../support/root/build-transport/probe.ts", import.meta.url),
        ),
        "--native-control",
      ],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("Miniflare did not invoke the actual undici dispatcher."),
  });
}, 30000);

it("initializes one bridge before serial or concurrent ESM and CommonJS consumers", async () => {
  const probe = fileURLToPath(
    new URL("../../../../support/root/build-transport/imports-probe.ts", import.meta.url),
  );
  const run = async (serial: boolean) => {
    const result = await promisify(execFile)(
      "bun",
      ["--no-env-file", probe, ...(serial ? ["--serial"] : [])],
      { timeout: 10000 },
    );
    expect(result.stdout.trim()).toBe("Wrangler CJS and Miniflare ESM share initialized exports");
  };
  // Fresh processes exercise initial module evaluation instead of an already warm cache.
  for (let attempt = 0; attempt < 8; attempt++) await run(true);
  for (let attempt = 0; attempt < 8; attempt++) await run(false);
  await Promise.all(Array.from({ length: 4 }, () => run(false)));
}, 30000);
