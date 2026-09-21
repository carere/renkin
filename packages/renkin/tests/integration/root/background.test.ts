import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { development } from "renkin";
import {
  applicationFixture,
  capturedEmails as readCapturedEmails,
  scheduled,
} from "renkin/testing";
import { createBackgroundFixture } from "#test-support/root/background-fixture.ts";

const fixture = Effect.acquireRelease(Effect.promise(createBackgroundFixture), (test) =>
  Effect.promise(test.close),
);
it.effect(
  "public scheduled event delivers a native queue message to Workflow steps and captured email",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(() =>
        test.run(async (session) => {
          const { workers, capturedEmails } = session;
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          const time = new Date("2026-07-30T12:00:00Z");
          await Effect.runPromise(scheduled(app, { cron: "* * * * *", scheduledTime: time }));
          const id = `scheduled-${time.getTime()}`;
          await expect
            .poll(
              async () => {
                const status = (await (await app.fetch(`/status/${id}`)).json()) as {
                  status: string;
                };
                if (status.status === "errored") throw new Error(JSON.stringify(status));
                return status;
              },
              { timeout: 12000 },
            )
            .toMatchObject({ status: "complete" });
          expect((await Effect.runPromise(readCapturedEmails(session))).length).toBe(1);
          const status = await (await app.fetch(`/status/${id}`)).json();
          expect(status).toMatchObject({
            status: "complete",
            output: { payload: { id, cron: "* * * * *" }, attempt: 1 },
          });
          expect(await (await app.fetch(`/${id}`)).text()).toBe("1");
          expect(await (await app.fetch("/scheduled-context")).text()).toBe("ready");
          expect((await capturedEmails())[0]).toContain(`Subject: Job ${id}`);
        }),
      );
    }),
  20000,
);

it.effect(
  "native Workflow resumes across process recreation with cached steps and original event",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        let timestamp = "";
        await test.run(async ({ workers }) => {
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          await app.fetch("/create/restart", {
            method: "POST",
            body: JSON.stringify({ sleep: "2 seconds", original: true }),
          });
          await expect.poll(async () => (await app.fetch("/restart")).text()).toBe("1");
          timestamp = await (await app.fetch("/restart-timestamp")).text();
        });
        await test.run(async ({ workers, capturedEmails }) => {
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          await expect
            .poll(async () => (await app.fetch("/status/restart")).json(), { timeout: 10000 })
            .toMatchObject({
              status: "complete",
              output: { attempt: 1, timestamp, payload: { original: true } },
            });
          expect(await (await app.fetch("/restart")).text()).toBe("1");
          expect((await capturedEmails()).length).toBe(1);
        });
      });
    }),
  20000,
);

it.effect(
  "native queue retries preserve acknowledgements and route exhausted messages to the DLQ",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(() =>
        test.run(async ({ workers }) => {
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          expect((await app.fetch("/batch")).status).toBe(200);
          await expect
            .poll(async () => (await app.fetch("/dead")).text())
            .toBe(JSON.stringify({ mode: "poison" }));
          expect(await (await app.fetch("/ack-attempts")).text()).toBe("1");
          expect(await (await app.fetch("/poison-attempts")).text()).toBe("2");
        }),
      );
    }),
);

it.effect(
  "Workflow retry attempt and pending event survive recreation while user pauses remain paused",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await test.run(async ({ workers }) => {
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          await app.fetch("/create/retry", {
            method: "POST",
            body: JSON.stringify({ retry: true, wait: true }),
          });
          await expect.poll(async () => (await app.fetch("/retry-attempt")).text()).toBe("1");
          await app.fetch("/create/paused", {
            method: "POST",
            body: JSON.stringify({ wait: true }),
          });
          await expect.poll(async () => (await app.fetch("/paused")).text()).toBe("1");
          await app.fetch("/pause/paused");
          await expect
            .poll(async () => (await app.fetch("/status/paused")).json())
            .toMatchObject({ status: "paused" });
        });
        await test.run(async ({ workers }) => {
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          expect(await (await app.fetch("/status/paused")).json()).toMatchObject({
            status: "paused",
          });
          await expect
            .poll(async () => (await app.fetch("/retry-attempt")).text(), { timeout: 10000 })
            .toBe("2");
          await app.fetch("/event/retry");
          await expect
            .poll(async () => (await app.fetch("/status/retry")).json(), { timeout: 10000 })
            .toMatchObject({ status: "complete" });
          expect(await (await app.fetch("/retry")).text()).toBe("1");
          await app.fetch("/resume/paused");
          await app.fetch("/event/paused");
          await expect
            .poll(async () => (await app.fetch("/status/paused")).json(), { timeout: 10000 })
            .toMatchObject({ status: "complete" });
        });
      });
    }),
  25000,
);

it.effect(
  "empty queues, DLQs, Workflows and owning Workers reject deletion and replacement before local changes",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await test.run(async () => {});
        await expect(test.run(async () => {}, { ...test.stack, resources: [] })).rejects.toThrow(
          "Deletion protection",
        );
        for (const id of ["Jobs", "Dead", "Flow", "App", "DeadWorker"]) {
          const desired = {
            ...test.stack,
            resources: test.stack.resources.map((resource) =>
              resource.id === id ? { ...resource, identity: "replacement" } : resource,
            ),
          };
          await expect(test.run(async () => {}, desired)).rejects.toThrow("Deletion protection");
        }
        await test.run(async ({ workers }) => {
          if (!workers.App) throw new Error("Missing Worker");
          expect((await workers.App.fetch()).status).toBe(200);
        });
      });
    }),
  30000,
);

it.effect(
  "public application fixture recovers interrupted Workflow wake and preserves native fatal errors",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const app = yield* applicationFixture(() =>
        development(test.stack, { directory: join(test.root, "state"), watch: false }),
      );
      yield* Effect.promise(async () => {
        const worker = app.current.workers.App;
        if (!worker) throw new Error("Missing Worker");
        await worker.fetch("/create/interrupted", {
          method: "POST",
          body: JSON.stringify({ wait: true }),
        });
        await expect.poll(async () => (await worker.fetch("/interrupted")).text()).toBe("1");
        await worker.fetch("/pause/interrupted");
        await expect
          .poll(async () => (await worker.fetch("/status/interrupted")).json())
          .toMatchObject({ status: "paused" });
        const path = join(test.root, "state/data/background-public/local/workflow-recovery.json");
        const records = JSON.parse(await readFile(path, "utf8")) as {
          id: string;
          recovering: boolean;
        }[];
        await writeFile(
          path,
          JSON.stringify(
            records.map((record) =>
              record.id === "interrupted" ? { ...record, recovering: true } : record,
            ),
          ),
        );
      });
      yield* app.restart;
      yield* Effect.promise(async () => {
        const worker = app.current.workers.App;
        if (!worker) throw new Error("Missing Worker");
        await worker.fetch("/event/interrupted");
        await expect
          .poll(async () => (await worker.fetch("/status/interrupted")).json(), { timeout: 10000 })
          .toMatchObject({ status: "complete" });
        expect(await (await worker.fetch("/interrupted")).text()).toBe("1");
        await worker.fetch("/create/fatal", {
          method: "POST",
          body: JSON.stringify({ fatal: true }),
        });
        await expect
          .poll(async () => (await worker.fetch("/status/fatal")).json())
          .toMatchObject({ status: "errored" });
        expect(await (await worker.fetch("/fatal-attempt")).text()).toBe("1");
      });
    }),
  20000,
);

it.effect(
  "Workflow absolute sleep deadline and cached task survive application reload",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(() =>
        test.run(async ({ workers }) => {
          const app = workers.App;
          if (!app) throw new Error("Missing Worker");
          const until = Date.now() + 4000;
          await app.fetch("/create/deadline", { method: "POST", body: JSON.stringify({ until }) });
          await expect.poll(async () => (await app.fetch("/deadline")).text()).toBe("1");
          await writeFile(
            test.entry,
            (await readFile(test.entry, "utf8")).replace(
              'new Response("healthy")',
              'new Response("reloaded")',
            ),
          );
          await app.reload();
          expect(await (await app.fetch()).text()).toBe("reloaded");
          if (Date.now() < until)
            expect(await (await app.fetch("/status/deadline")).json()).not.toMatchObject({
              status: "complete",
            });
          await expect
            .poll(async () => (await app.fetch("/status/deadline")).json(), { timeout: 10000 })
            .toMatchObject({ status: "complete" });
          expect(Date.now()).toBeGreaterThanOrEqual(until);
          expect(await (await app.fetch("/deadline")).text()).toBe("1");
        }),
      );
    }),
  20000,
);
