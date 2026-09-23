import { removeEnvironment } from "@carere/renkin";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  createCloudDurableObjectFixture,
  durableObjectUrl,
} from "#test-support/root/cloud-durable-object-fixture.ts";

it.effect(
  "public cloud class addition, persistent identity, alarm, rename and protected cleanup",
  () =>
    Effect.promise(async () => {
      const test = await createCloudDurableObjectFixture();
      try {
        await test.run();
        await test.addClass();
        const deployed = await test.run();
        const url = durableObjectUrl(deployed.resources.Api?.outputs);
        await expect(Effect.runPromise(removeEnvironment(test.name, test.options))).rejects.toThrow(
          "Deletion protection",
        );
        await expect
          .poll(
            async () =>
              (await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => undefined))
                ?.status,
            { timeout: 15000 },
          )
          .toBe(200);
        const request = async (path: string) => {
          const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(5000) });
          expect(response.status).toBe(200);
          return response.json() as Promise<{
            id: string;
            value?: number;
            last?: number;
            alarm?: number;
          }>;
        };
        const first = await request("/increment");
        expect(first.value).toBe(1);
        await request("/schedule");
        await test.run(false, true);
        await expect.poll(async () => (await request("/")).alarm, { timeout: 15000 }).toBe(1);
        expect(await request("/increment")).toEqual({ id: first.id, value: 2 });
        await test.renameClass();
        await test.run();
        expect(await request("/")).toEqual({ id: first.id, last: 2, alarm: 1 });
        expect(await request("/increment")).toEqual({ id: first.id, value: 3 });
      } finally {
        await test.close();
      }
    }),
  360000,
);
