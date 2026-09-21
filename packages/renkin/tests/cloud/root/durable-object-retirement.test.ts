import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  createCloudDurableObjectFixture,
  durableObjectUrl,
} from "../../support/root/cloud-durable-object-fixture.ts";

it.effect(
  "verified class rename preserves namespace ID and exact authorized retirement keeps its Worker",
  () =>
    Effect.promise(async () => {
      const test = await createCloudDurableObjectFixture();
      try {
        await test.addClass();
        const initial = await test.run();
        const url = durableObjectUrl(initial.resources.Api?.outputs);
        expect(initial.resources.Counters?.outputs).toMatchObject({
          namespaceId: expect.any(String),
        });
        await test.renameClass();
        const renamed = await test.run();
        expect(renamed.resources.Counters?.outputs).toEqual({
          ...(initial.resources.Counters?.outputs as object),
          className: "RenamedCounter",
        });
        await test.removeClass();
        const blocked = await test.run().then(
          () => false,
          () => true,
        );
        expect(blocked).toBe(true);
        await test.addClass();
        await test.run(true);
        await test.removeClass();
        const retired = await test.run(true);
        expect(retired.resources.Counters).toBeUndefined();
        expect(retired.resources.Api?.physicalId).toBe(initial.resources.Api?.physicalId);
        await expect
          .poll(async () => (await fetch(url, { signal: AbortSignal.timeout(3000) })).text(), {
            timeout: 15000,
          })
          .toBe("ready");
        process.stdout.write(
          `Cloud DO exact namespace retired with owner preserved: ${test.name}/objects\n`,
        );
      } finally {
        await test.close();
      }
    }),
  360000,
);
