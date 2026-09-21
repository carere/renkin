import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { removeEnvironment } from "renkin";
import {
  createCloudDurableObjectFixture,
  durableObjectUrl,
} from "../../support/root/cloud-durable-object-fixture.ts";

it.effect(
  "interrupted post-publication namespace observation preserves protection and recovers native data",
  () =>
    Effect.promise(async () => {
      const test = await createCloudDurableObjectFixture();
      const fetchBeforeFault = globalThis.fetch;
      let armed = false;
      let observations = 0;
      // Install before the first SDK read: Effect memoizes its default fetch reference.
      globalThis.fetch = async (input, init) => {
        const requestUrl = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
        );
        if (
          armed &&
          requestUrl.hostname === "api.cloudflare.com" &&
          requestUrl.pathname.endsWith("/workers/durable_objects/namespaces") &&
          ++observations >= 4
        )
          throw new Error("Controlled loss of the post-publication namespace observation.");
        return fetchBeforeFault(input, init);
      };
      try {
        await test.addClass();
        const state = await test.run();
        expect(state.resources.Counters?.outputs).toMatchObject({
          namespaceId: expect.any(String),
        });
        const url = durableObjectUrl(state.resources.Api?.outputs);
        await expect
          .poll(
            async () =>
              (await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => undefined))
                ?.status,
            { timeout: 15000 },
          )
          .toBe(200);
        const first = (await (await fetch(new URL("/increment", url))).json()) as {
          id: string;
          value: number;
        };
        expect(first.value).toBe(1);
        armed = true;
        const failed = await test.run(false, true).then(
          () => false,
          () => true,
        );
        expect(failed).toBe(true);
        expect(observations).toBe(4);
        armed = false;
        await expect(Effect.runPromise(removeEnvironment(test.name, test.options))).rejects.toThrow(
          "Deletion protection",
        );
        const recovered = await test.run();
        expect(recovered.resources.Counters?.physicalId).toBe(state.resources.Counters?.physicalId);
        expect(recovered.resources.Counters?.outputs).toEqual(state.resources.Counters?.outputs);
        expect(await (await fetch(new URL("/increment", url))).json()).toEqual({
          id: first.id,
          value: 2,
        });
        process.stdout.write(`Cloud DO interrupted binding recovered: ${test.name}/objects\n`);
      } finally {
        armed = false;
        globalThis.fetch = fetchBeforeFault;
        await test.close();
      }
    }),
  360000,
);
