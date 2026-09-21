import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { execute, installConsumer } from "../../support/root/release/consumer.ts";
import { verifyApplications } from "../../support/root/release/verify-applications.ts";
import { verifyGraph } from "../../support/root/release/verify-graph.ts";
import { verifyPackage } from "../../support/root/release/verify-package.ts";
import { verifySourceGuard } from "../../support/root/release/verify-source-guard.ts";
import { verifyTypes } from "../../support/root/release/verify-types.ts";

it("packs and installs the public artifact without workspace resolution", async () => {
  const root = fileURLToPath(new URL("../../../../..", import.meta.url));
  await verifySourceGuard(root);
  const packed = await execute(
    process.execPath,
    ["--no-env-file", join(root, "packages/renkin/release.ts"), "pack"],
    { cwd: root, maxBuffer: 200000 },
  );
  const { archive } = JSON.parse(packed.stdout) as { archive: string };
  const consumer = await installConsumer(root, archive);
  try {
    console.info(await verifyPackage(consumer, archive));
    console.info(await verifyTypes(consumer));
    await verifyApplications(consumer);
    console.info(await verifyGraph(consumer));
  } finally {
    await consumer.close();
  }
}, 600000);
