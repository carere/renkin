import { expect, it } from "@effect/vitest";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { queue } from "../../../../../src/contexts/root/models/queue.ts";
import { cloudflareQueueService } from "../../../../../src/contexts/root/services/background/cloudflare-queue-service.ts";
import { cloudflareWorkflowService } from "../../../../../src/contexts/root/services/background/cloudflare-workflow-service.ts";
import {
  assertNoOwnedWorkflows,
  reconcileWorkerBackground,
} from "../../../../../src/contexts/root/services/worker/worker-background.ts";
import { backgroundHttp } from "../../../../support/root/services/background/background-http.ts";

const job: ResourceState = {
  definition: queue("Jobs"),
  physicalId: "old-id",
  outputs: { id: "old-id", name: "old-name" },
};
const observedQueue = {
  queue_id: "old-id",
  queue_name: "old-name",
  settings: { delivery_delay: 0 },
  consumers: [],
};
const worker: ResourceState = {
  definition: {
    id: "App",
    type: "cloudflare.worker",
    identity: "worker",
    properties: { consumers: [{ queue: "Jobs", maxRetries: 1 }], crons: [] },
  },
  physicalId: "new-worker",
  outputs: {
    consumerQueues: [{ id: "old-id", name: "old-name" }],
    consumerScripts: ["old-worker", "new-worker"],
    managedWorkflows: true,
  },
};

it.effect(
  "queue replacement allocates a distinct server ID, recovers the allocation and deletes only the old namespace",
  () =>
    Effect.promise(async () => {
      const created = {
        queue_id: "new-id",
        queue_name: "new-allocation",
        settings: { delivery_delay: 0 },
      };
      const test = await backgroundHttp([
        [],
        created,
        created,
        [created],
        created,
        observedQueue,
        null,
      ]);
      try {
        const service = cloudflareQueueService(test.client, "lease");
        const outputs = await service.apply(job.definition, "new-allocation", job);
        expect(outputs).toEqual({ id: "new-id", name: "new-allocation" });
        expect(service.resolvePhysicalId?.(job.definition, "new-allocation", outputs)).toBe(
          "new-id",
        );
        expect(await service.apply(job.definition, "new-allocation", job)).toEqual(outputs);
        await service.remove(job);
        expect(test.calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(
          test.calls.filter((call) => call.method === "DELETE").map((call) => call.path),
        ).toEqual(["/accounts/account/queues/old-id"]);
      } finally {
        await test.close();
      }
    }),
);

it.effect(
  "queue and Workflow deletion reject foreign ownership and remaining queue producers",
  () =>
    Effect.promise(async () => {
      for (const current of [
        { ...observedQueue, queue_name: "foreign" },
        { ...observedQueue, producers: [{ script_name: "outside", type: "worker" }] },
      ]) {
        const test = await backgroundHttp([current]);
        try {
          await expect(cloudflareQueueService(test.client, "lease").remove(job)).rejects.toThrow();
          expect(test.calls.every((call) => call.method === "GET")).toBe(true);
        } finally {
          await test.close();
        }
      }
      const test = await backgroundHttp([
        { id: "flow", name: "flow", script_name: "foreign", class_name: "Job" },
      ]);
      try {
        await expect(
          cloudflareWorkflowService(test.client, "lease").remove({
            definition: {
              id: "Flow",
              type: "cloudflare.workflow",
              identity: "flow",
              properties: {},
            },
            physicalId: "flow",
            outputs: { scriptName: "owned", className: "Job" },
          }),
        ).rejects.toThrow("ownership");
        expect(test.calls.every((call) => call.method === "GET")).toBe(true);
      } finally {
        await test.close();
      }
    }),
);

it.effect(
  "consumer replacement verifies Worker ownership and interrupted detach resumes without duplicate deletion",
  () =>
    Effect.promise(async () => {
      const consumer = {
        consumer_id: "consumer",
        type: "worker",
        script_name: "old-worker",
        settings: { max_retries: 3 },
      };
      const test = await backgroundHttp([
        { ...observedQueue, consumers: [consumer] },
        { ...consumer, script_name: "new-worker" },
        { ...observedQueue, consumers: [{ ...consumer, script_name: "new-worker" }] },
        null,
        observedQueue,
      ]);
      const owners: string[] = [];
      try {
        await reconcileWorkerBackground(worker, { Jobs: job }, test.client, "lease", async (name) =>
          owners.push(name),
        );
        await reconcileWorkerBackground(
          worker,
          {},
          test.client,
          "lease",
          async (name) => owners.push(name),
          true,
        );
        await reconcileWorkerBackground(
          worker,
          {},
          test.client,
          "lease",
          async (name) => owners.push(name),
          true,
        );
        expect(owners).toEqual(["old-worker", "new-worker"]);
        expect(
          test.calls.filter((call) => call.method === "PUT").map((call) => JSON.parse(call.body)),
        ).toMatchObject([{ script_name: "new-worker", settings: { max_retries: 1 } }]);
        expect(test.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
      } finally {
        await test.close();
      }
    }),
);

it.effect("foreign consumers and retained empty Workflows block destructive Worker actions", () =>
  Effect.promise(async () => {
    const test = await backgroundHttp([
      {
        ...observedQueue,
        consumers: [{ consumer_id: "foreign", type: "worker", script_name: "outside" }],
      },
      [{ id: "flow", name: "flow", script_name: "new-worker", class_name: "Job" }],
    ]);
    try {
      await expect(
        reconcileWorkerBackground(worker, {}, test.client, "lease", async () => {}, true),
      ).rejects.toThrow("another Worker");
      await expect(assertNoOwnedWorkflows(worker, test.client)).rejects.toThrow(
        "still owns a Workflow",
      );
      expect(test.calls.every((call) => call.method === "GET")).toBe(true);
    } finally {
      await test.close();
    }
  }),
);
