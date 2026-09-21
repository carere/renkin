import type { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
import { backgroundProperties, stringProperty } from "./background-properties.ts";

type Client = ReturnType<typeof createBackgroundClient>;
const observe = (client: Client, id: string) =>
  Effect.runPromise(
    client.getQueue(id).pipe(Effect.catchTag("QueueNotFound", () => Effect.succeed(undefined))),
  );
const findAllocation = async (client: Client, name: string) => {
  const matches: { queueId?: string | null; queueName?: string | null }[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = await Effect.runPromise(client.listQueues(page));
    matches.push(...result.result.filter((queue) => queue.queueName === name));
    if (matches.length > 1) throw new Error("Ambiguous queue allocation marker.");
    if (
      result.result.length < 100 ||
      (result.resultInfo?.totalPages != null && page >= result.resultInfo.totalPages)
    )
      return matches[0];
  }
  throw new Error("Queue inventory exceeded the bounded ownership lookup.");
};
export const cloudflareQueueService = (client: Client, token: string): ResourceService => ({
  deferredBindings: true,
  refresh: true,
  apply: async (definition, allocation, previous) => {
    const updating = previous?.physicalId === allocation;
    const current = updating
      ? await observe(client, allocation)
      : await findAllocation(client, allocation);
    const name = updating && previous ? stringProperty(previous.outputs, "name") : allocation;
    if (updating && (!current || current.queueName !== name))
      throw new Error("Queue ownership differs from the recorded allocation.");
    const queue = current ?? (await Effect.runPromise(client.createQueue(name, token)));
    if (!queue.queueId || queue.queueName !== name)
      throw new Error("Queue provider returned an invalid allocation.");
    const properties = backgroundProperties(definition.properties);
    const deliveryDelay = properties.deliveryDelay;
    const messageRetentionPeriod = properties.messageRetentionPeriod;
    if (
      typeof deliveryDelay !== "number" ||
      (messageRetentionPeriod !== undefined && typeof messageRetentionPeriod !== "number")
    )
      throw new Error("Queue settings must be prepared.");
    const observed = await observe(client, queue.queueId);
    if (
      observed?.settings?.deliveryDelay !== deliveryDelay ||
      (messageRetentionPeriod !== undefined &&
        observed.settings.messageRetentionPeriod !== messageRetentionPeriod)
    )
      await Effect.runPromise(
        client.updateQueue(
          {
            queueId: queue.queueId,
            queueName: name,
            settings: {
              deliveryDelay,
              ...(messageRetentionPeriod === undefined ? {} : { messageRetentionPeriod }),
            },
          },
          token,
        ),
      );
    return { id: queue.queueId, name };
  },
  resolvePhysicalId: (_definition, _allocation, outputs) => stringProperty(outputs, "id"),
  remove: async (resource) => {
    const current = await observe(client, resource.physicalId);
    if (!current) return;
    if (current.queueName !== stringProperty(resource.outputs, "name"))
      throw new Error("Queue ownership differs from the recorded allocation.");
    if (current.consumers?.length)
      throw new Error("Detach the queue's consumers before deleting it.");
    if (current.producers?.length)
      throw new Error("Detach the queue's producers before deleting it.");
    await Effect.runPromise(client.deleteQueue(resource.physicalId, token));
  },
});
