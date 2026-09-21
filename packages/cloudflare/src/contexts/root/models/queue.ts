import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { QueueRequirement } from "@renkin/runtime/models/queue";

export interface QueueOptions {
  readonly deliveryDelay?: number;
  readonly messageRetentionPeriod?: number;
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  readonly identity?: string;
}
export interface QueueResource<Body = unknown> extends ResourceDefinition, QueueRequirement<Body> {
  readonly type: "cloudflare.queue";
}
export interface QueueConsumer {
  readonly queue: QueueResource;
  readonly maxBatchSize?: number;
  readonly maxBatchTimeout?: number;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
  readonly maxConcurrency?: number | null;
  readonly deadLetterQueue?: QueueResource;
}
export const queue = <Body = unknown>(
  id: string,
  options: QueueOptions = {},
): QueueResource<Body> => ({
  id,
  type: "cloudflare.queue",
  identity: options.identity ?? "queue",
  properties: {
    deliveryDelay: options.deliveryDelay ?? 0,
    ...(options.messageRetentionPeriod === undefined
      ? {}
      : { messageRetentionPeriod: options.messageRetentionPeriod }),
  },
  protection: { data: true, allowDelete: options.allowDelete ?? false },
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
