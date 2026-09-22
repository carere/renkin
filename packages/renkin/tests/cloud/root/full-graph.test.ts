import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  assertCloudCron,
  assertCloudFlow,
} from "#test-support/root/cloud-full-graph/assertions.ts";
import { createCloudGraphFixture } from "#test-support/root/cloud-full-graph/fixture.ts";

const reuseOnly = process.env.RENKIN_CLOUDFLARE_GRAPH_REUSE_ONLY === "true";

it.effect(
  reuseOnly
    ? "cloud graph reuse-only: three frontend artifacts, cron update and stable Worker identity without application flow"
    : "cloud eight-app graph reuses frontend builds while reconciling native resources and cron",
  () =>
    Effect.promise(async () => {
      const test = await createCloudGraphFixture();
      try {
        const first = await Effect.runPromise(test.apply());
        expect(test.compilations()).toBe(3);
        if (!reuseOnly) await assertCloudFlow(first);
        await assertCloudCron(first, "0 0 1 1 *");
        const changed = await Effect.runPromise(test.apply("0 1 1 1 *"));
        expect(test.compilations()).toBe(3);
        await assertCloudCron(changed, "0 1 1 1 *");
        expect(changed.resources.Tracking?.physicalId).toBe(first.resources.Tracking?.physicalId);
        console.info("Cloud graph cron-only update observed; all three frontend artifacts reused.");
      } finally {
        await test.close();
      }
    }),
  1200000,
);
