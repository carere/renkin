import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";

it("uses the real dispatcher only inside the official build runtime", async () => {
  const result = await promisify(execFile)(
    "bun",
    [fileURLToPath(new URL("../../../support/root/build-transport/probe.ts", import.meta.url))],
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
        fileURLToPath(new URL("../../../support/root/build-transport/probe.ts", import.meta.url)),
        "--native-control",
      ],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("Miniflare did not invoke the actual undici dispatcher."),
  });
}, 30000);
