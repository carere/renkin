import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { QueueConsumer } from "./queue.ts";
import type { WorkerExtensions } from "./worker-extensions.ts";

export interface WorkerOptions extends WorkerExtensions {
  readonly entry?: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly bindings?: Readonly<Record<string, string>>;
  readonly port?: number;
  /** Explicit replacement trigger. Defaults to the logical ID. */
  readonly identity?: string;
  readonly dependencies?: readonly ResourceDefinition[];
  readonly data?: boolean;
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  readonly crons?: readonly string[];
  readonly consumers?: readonly QueueConsumer[];
}

export interface WorkerResource extends ResourceDefinition {
  readonly type: "cloudflare.worker";
  readonly options: WorkerOptions;
}

export const worker = (id: string, options: WorkerOptions): WorkerResource => ({
  id,
  type: "cloudflare.worker",
  identity: options.identity ?? "worker",
  dependencies: [
    ...new Set([
      ...(options.dependencies?.map((resource) => resource.id) ?? []),
      ...(options.consumers ?? []).flatMap((consumer) => [
        consumer.queue.id,
        ...(consumer.deadLetterQueue ? [consumer.deadLetterQueue.id] : []),
      ]),
    ]),
  ],
  protection: {
    data: Boolean(options.data || options.consumers?.length),
    allowDelete: options.allowDelete ?? false,
  },
  properties: {
    entry: options.entry ?? options.build?.entry ?? "",
    workersDev: options.workersDev ?? true,
    ...(options.observability
      ? { observability: JSON.parse(JSON.stringify(options.observability)) }
      : {}),
    compatibilityDate: options.compatibilityDate,
    compatibilityFlags: options.compatibilityFlags ?? ["nodejs_compat"],
    bindings: options.bindings ?? {},
    crons: options.crons ?? [],
    consumers: (options.consumers ?? []).map(({ queue, deadLetterQueue, ...settings }) => ({
      queue: queue.id,
      ...(deadLetterQueue ? { deadLetterQueue: deadLetterQueue.id } : {}),
      ...settings,
    })),
  },
  options,
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
