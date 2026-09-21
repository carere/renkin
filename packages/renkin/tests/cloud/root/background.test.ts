import { randomUUID } from "node:crypto";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { removeEnvironment } from "renkin";
import { createCloudBackgroundFixture } from "../../support/root/cloud-background-fixture.ts";

it.effect(
  "cloud queues, Workflow tasks and authorized email use native bindings with protected cleanup",
  () =>
    Effect.promise(async () => {
      const test = await createCloudBackgroundFixture();
      let attempts = "0";
      let workerUrl: string | undefined;
      try {
        const state = await test.deploy();
        console.info(
          `Cloud background owned resources: ${Object.values(state.resources)
            .map((resource) => `${resource.definition.type}=${resource.physicalId}`)
            .join(", ")}`,
        );
        const output = state.resources.App?.outputs as { url?: string } | undefined;
        if (!output?.url) throw new Error("Missing Worker URL");
        const url = output.url;
        workerUrl = url;
        const read = async (path: string) =>
          fetch(new URL(path, url), { signal: AbortSignal.timeout(15000) });
        await expect
          .poll(async () => (await read("/")).status, { timeout: 45000, interval: 1000 })
          .toBe(200);
        await expect(Effect.runPromise(removeEnvironment(test.name, test.options))).rejects.toThrow(
          "Deletion protection",
        );
        const id = `job-${randomUUID()}`;
        attempts = "unknown (at most one)";
        const sent = await fetch(new URL("/send", url), {
          method: "POST",
          body: JSON.stringify({ id, origin: "authorized-cloud-test", retry: true }),
          signal: AbortSignal.timeout(15000),
        });
        expect(sent.status).toBe(200);
        await expect
          .poll(
            async () => {
              return (await read(`/status/${id}`)).json();
            },
            { timeout: 90000, interval: 1500 },
          )
          .toMatchObject({
            status: "complete",
            output: { attempt: 2, payload: { id, origin: "authorized-cloud-test", retry: true } },
          });
        await expect
          .poll(
            async () => {
              attempts = await (await read("/email-attempts")).text();
              return attempts;
            },
            { timeout: 90000, interval: 1500 },
          )
          .toBe("1");
        await expect
          .poll(async () => (await read("/email-accepted")).text(), {
            timeout: 90000,
            interval: 1500,
          })
          .toBe("yes");
        console.info("Cloud background email: one authorized native send accepted.");
        await assertDeadLetter(url, read);
      } finally {
        if (workerUrl)
          attempts = await fetch(new URL("/email-attempts", workerUrl), {
            signal: AbortSignal.timeout(10000),
          })
            .then((response) => (response.ok ? response.text() : attempts))
            .catch(() => attempts);
        console.info(`Cloud background observed email attempts: ${attempts || "unknown"}`);
        await test.close();
      }
    }),
  420000,
);

const assertDeadLetter = async (url: string, read: (path: string) => Promise<Response>) => {
  await fetch(new URL("/send", url), {
    method: "POST",
    body: JSON.stringify({ poison: true }),
    signal: AbortSignal.timeout(15000),
  });
  await expect
    .poll(async () => (await read("/dead")).text(), { timeout: 60000, interval: 1500 })
    .toBe(JSON.stringify({ poison: true }));
  expect(await (await read("/queue-attempt")).text()).toBe("2");
};
