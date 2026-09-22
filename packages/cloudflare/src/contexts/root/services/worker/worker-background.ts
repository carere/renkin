import type {
  createBackgroundClient,
  QueueConsumerSettings,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import {
  backgroundProperties as object,
  stringProperty,
} from "#src/contexts/root/services/background/background-properties.ts";

type Client = ReturnType<typeof createBackgroundClient>;
type Resources = Readonly<Record<string, ResourceState>>;
const consumers = (definition: ResourceDefinition) => {
  const value = object(definition.properties).consumers ?? [];
  if (!Array.isArray(value)) throw new Error("Invalid queue consumers.");
  return value.map(object);
};
const queueState = (id: Json | undefined, resources: Resources) => {
  const target = typeof id === "string" ? resources[id] : undefined;
  if (target?.definition.type !== "cloudflare.queue")
    throw new Error("Consumer queue is not provisioned.");
  return { id: target.physicalId, name: stringProperty(target.outputs, "name") };
};
export const backgroundOutputs = (
  definition: ResourceDefinition,
  physicalId: string,
  previous: ResourceState | undefined,
  resources: Resources,
) => {
  const old = previous ? object(previous.outputs ?? {}) : {};
  const recorded = Array.isArray(old.consumerQueues) ? old.consumerQueues.map(object) : [];
  const queues = [
    ...recorded,
    ...consumers(definition).map((consumer) => queueState(consumer.queue, resources)),
  ];
  return {
    managedWorkflows: Boolean(
      old.managedWorkflows ||
        (object(definition.properties).workflowClasses as readonly string[] | undefined)?.length,
    ),
    managedCrons: Boolean(
      old.managedCrons ||
        (object(definition.properties).crons as readonly string[] | undefined)?.length,
    ),
    consumerQueues: [...new Map(queues.map((queue) => [queue.id, queue])).values()],
    consumerScripts: [
      ...new Set([
        physicalId,
        ...(previous ? [previous.physicalId] : []),
        ...(Array.isArray(old.consumerScripts)
          ? old.consumerScripts.filter((name): name is string => typeof name === "string")
          : []),
      ]),
    ],
  };
};
const settings = (consumer: Readonly<Record<string, Json>>): QueueConsumerSettings => ({
  batchSize: Number(consumer.maxBatchSize ?? 10),
  maxWaitTimeMs: Number(consumer.maxBatchTimeout ?? 5) * 1000,
  maxRetries: Number(consumer.maxRetries ?? 3),
  retryDelay: Number(consumer.retryDelay ?? 0),
  maxConcurrency: consumer.maxConcurrency == null ? null : Number(consumer.maxConcurrency),
});
const reconcileQueue = (
  queue: Readonly<Record<string, Json>>,
  desired: Readonly<Record<string, Json>> | undefined,
  resource: ResourceState,
  resources: Resources,
  client: Client,
  token: string,
  verifyOwner: (name: string) => Effect.Effect<unknown, Error>,
) =>
  Effect.gen(function* () {
    const queueId = stringProperty(queue, "id");
    const observed = yield* client
      .getQueue(queueId)
      .pipe(Effect.catchTag("QueueNotFound", () => Effect.succeed(undefined)));
    if (!observed) {
      if (desired) return yield* Effect.fail(new Error("Consumer queue is missing."));
      return;
    }
    if (observed.queueName !== queue.name)
      return yield* Effect.fail(new Error("Consumer queue ownership changed."));
    const existing = observed.consumers ?? [];
    if (existing.length > 1)
      return yield* Effect.fail(new Error("Queue has ambiguous consumer ownership."));
    const current = existing[0];
    if (current) {
      const scripts = object(resource.outputs ?? {}).consumerScripts;
      if (
        !("scriptName" in current) ||
        typeof current.scriptName !== "string" ||
        !Array.isArray(scripts) ||
        !scripts.includes(current.scriptName)
      )
        return yield* Effect.fail(new Error("Queue consumer belongs to another Worker."));
      yield* verifyOwner(current.scriptName);
      if (!current.consumerId)
        return yield* Effect.fail(new Error("Queue consumer has no provider identity."));
    }
    if (!desired) {
      if (current?.consumerId) yield* client.deleteConsumer(queueId, current.consumerId, token);
      return;
    }
    const policy = settings(desired);
    const deadLetterQueue = desired.deadLetterQueue
      ? queueState(desired.deadLetterQueue, resources).name
      : "";
    const currentSettings = current?.settings as Record<string, unknown> | undefined;
    if (
      current &&
      "scriptName" in current &&
      current.scriptName === resource.physicalId &&
      (current.deadLetterQueue ?? "") === deadLetterQueue &&
      Object.entries(policy).every(([key, value]) => (currentSettings?.[key] ?? null) === value)
    )
      return;
    const input = {
      queueId,
      scriptName: resource.physicalId,
      type: "worker",
      deadLetterQueue,
      settings: policy,
    };
    if (current?.consumerId)
      yield* client.updateConsumer({ ...input, consumerId: current.consumerId }, token);
    else yield* client.createConsumer(input, token);
  });
export const reconcileWorkerBackground = (
  resource: ResourceState,
  resources: Resources,
  client: Client | undefined,
  token: string,
  verifyOwner: (name: string) => Effect.Effect<unknown, Error>,
  removing = false,
) =>
  Effect.gen(function* () {
    const output = object(resource.outputs ?? {});
    const queues = Array.isArray(output.consumerQueues) ? output.consumerQueues.map(object) : [];
    if (!client) {
      if (output.managedCrons || queues.length)
        return yield* Effect.fail(new Error("Background client is required for this Worker."));
      return;
    }
    const desired = removing ? [] : consumers(resource.definition);
    for (const queue of queues)
      yield* reconcileQueue(
        queue,
        desired.find((consumer) => queueState(consumer.queue, resources).id === queue.id),
        resource,
        resources,
        client,
        token,
        verifyOwner,
      );
    if (output.managedCrons && !removing) {
      const crons = object(resource.definition.properties).crons as readonly string[];
      const current = yield* client.getSchedules(resource.physicalId);
      if (
        JSON.stringify(current.schedules.map((item) => item.cron).sort()) !==
        JSON.stringify([...crons].sort())
      )
        yield* client.putSchedules(resource.physicalId, crons, token);
    }
  });
/** Even a retained empty Workflow prevents generic Worker deletion. Never use force. */
export const assertNoOwnedWorkflows = (resource: ResourceState, client: Client | undefined) =>
  Effect.gen(function* () {
    if (!object(resource.outputs ?? {}).managedWorkflows) return;
    if (!client)
      return yield* Effect.fail(
        new Error("Background client is required to verify Workflow ownership."),
      );
    const name = resource.physicalId;
    for (let page = 1; page <= 100; page++) {
      const result = yield* client.listWorkflows(page);
      if (result.result.some((flow) => flow.scriptName === name))
        return yield* Effect.fail(
          new Error(
            "Worker still owns a Workflow; explicitly remove it before deleting the Worker.",
          ),
        );
      if (
        result.result.length < 100 ||
        (result.resultInfo?.totalPages != null && page >= result.resultInfo.totalPages)
      )
        return;
    }
    return yield* Effect.fail(
      new Error("Workflow inventory exceeded the bounded ownership lookup."),
    );
  });
