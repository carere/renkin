import type { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
import { backgroundProperties, stringProperty } from "./background-properties.ts";

type Client = ReturnType<typeof createBackgroundClient>;
const observe = (client: Client, id: string) =>
  client.getQueue(id).pipe(Effect.catchTag("QueueNotFound", () => Effect.succeed(undefined)));
const findAllocation = (client: Client, name: string) =>
  Effect.gen(function* () {
    const matches: { queueId?: string | null; queueName?: string | null }[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = yield* client.listQueues(page);
      matches.push(...result.result.filter((queue) => queue.queueName === name));
      if (matches.length > 1)
        return yield* Effect.fail(new Error("Ambiguous queue allocation marker."));
      if (
        result.result.length < 100 ||
        (result.resultInfo?.totalPages != null && page >= result.resultInfo.totalPages)
      )
        return matches[0];
    }
    return yield* Effect.fail(new Error("Queue inventory exceeded the bounded ownership lookup."));
  });
export const cloudflareQueueService = (client: Client, token: string): ResourceService => ({
  deferredBindings: true,
  refresh: true,
  apply: (definition, allocation, previous) =>
    Effect.gen(function* () {
      const updating = previous?.physicalId === allocation;
      const current = updating
        ? yield* observe(client, allocation)
        : yield* findAllocation(client, allocation);
      const name = updating && previous ? stringProperty(previous.outputs, "name") : allocation;
      if (updating && (!current || current.queueName !== name))
        return yield* Effect.fail(
          new Error("Queue ownership differs from the recorded allocation."),
        );
      const queue = current ?? (yield* client.createQueue(name, token));
      if (!queue.queueId || queue.queueName !== name)
        return yield* Effect.fail(new Error("Queue provider returned an invalid allocation."));
      const properties = backgroundProperties(definition.properties);
      const deliveryDelay = properties.deliveryDelay;
      const messageRetentionPeriod = properties.messageRetentionPeriod;
      if (
        typeof deliveryDelay !== "number" ||
        (messageRetentionPeriod !== undefined && typeof messageRetentionPeriod !== "number")
      )
        return yield* Effect.fail(new Error("Queue settings must be prepared."));
      const observed = yield* observe(client, queue.queueId);
      if (
        observed?.settings?.deliveryDelay !== deliveryDelay ||
        (messageRetentionPeriod !== undefined &&
          observed.settings.messageRetentionPeriod !== messageRetentionPeriod)
      )
        yield* client.updateQueue(
          {
            queueId: queue.queueId,
            queueName: name,
            settings: {
              deliveryDelay,
              ...(messageRetentionPeriod === undefined ? {} : { messageRetentionPeriod }),
            },
          },
          token,
        );
      return { id: queue.queueId, name };
    }),
  resolvePhysicalId: (_definition, _allocation, outputs) => stringProperty(outputs, "id"),
  remove: (resource) =>
    Effect.gen(function* () {
      const current = yield* observe(client, resource.physicalId);
      if (!current) return;
      if (current.queueName !== stringProperty(resource.outputs, "name"))
        return yield* Effect.fail(
          new Error("Queue ownership differs from the recorded allocation."),
        );
      if (current.consumers?.length)
        return yield* Effect.fail(new Error("Detach the queue's consumers before deleting it."));
      if (current.producers?.length)
        return yield* Effect.fail(new Error("Detach the queue's producers before deleting it."));
      yield* client.deleteQueue(resource.physicalId, token);
    }),
});
