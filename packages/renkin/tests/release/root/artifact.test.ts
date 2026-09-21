import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { releaseArchive } from "../../support/root/release/archive.ts";
import { installConsumer } from "../../support/root/release/consumer.ts";
import { verifyApplications } from "../../support/root/release/verify-applications.ts";
import { verifyBuilds } from "../../support/root/release/verify-builds.ts";
import { verifyGraph } from "../../support/root/release/verify-graph.ts";
import { verifyPackage } from "../../support/root/release/verify-package.ts";
import { verifySourceGuard } from "../../support/root/release/verify-source-guard.ts";
import { verifyTypes } from "../../support/root/release/verify-types.ts";

it("packs and installs the public artifact without workspace resolution", async () => {
  const root = fileURLToPath(new URL("../../../../..", import.meta.url));
  await verifySourceGuard(root);
  const archive = await releaseArchive(root);
  const consumer = await installConsumer(root, archive);
  try {
    console.info(await verifyPackage(consumer, archive));
    console.info(await verifyTypes(consumer));
    await verifyApplications(consumer);
    console.info(await verifyGraph(consumer));
    console.info(await verifyBuilds(consumer, root));
  } finally {
    await consumer.close();
  }
}, 600000);
