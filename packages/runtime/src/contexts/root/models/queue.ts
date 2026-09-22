import type { MessageBatch, Queue } from "@cloudflare/workers-types";
import { Effect } from "effect";

export interface QueueRequirement<Body = unknown> {
  readonly type: "cloudflare.queue";
  readonly id: string;
  readonly bodyType?: Body;
}
export type NativeQueue<Body = unknown> = Queue<Body>;
export type QueueBatch<Body = unknown> = MessageBatch<Body>;
export class QueueError extends Error {
  readonly name = "QueueError";
  constructor(
    readonly binding: string,
    readonly operation: string,
  ) {
    super(`Queue ${binding} failed during ${operation}.`);
  }
}
export const queueClient = <Body>(native: NativeQueue<Body>, binding: string) => ({
  native,
  send: (body: Body, options?: Parameters<NativeQueue<Body>["send"]>[1]) =>
    Effect.tryPromise({
      try: () => native.send(body, options),
      catch: () => new QueueError(binding, "send"),
    }),
  sendBatch: (
    messages: Parameters<NativeQueue<Body>["sendBatch"]>[0],
    options?: Parameters<NativeQueue<Body>["sendBatch"]>[1],
  ) =>
    Effect.tryPromise({
      try: () => native.sendBatch(messages, options),
      catch: () => new QueueError(binding, "sendBatch"),
    }),
});
export type QueueClient<Body = unknown> = ReturnType<typeof queueClient<Body>>;
