import { defineWorker } from "@carere/renkin/worker";
import { expect, it } from "@effect/vitest";
import { Context, Effect } from "effect";

class Greeting extends Context.Service<Greeting, { readonly text: string }>()("Greeting") {}

// @ts-expect-error Missing service requirements must not disappear from public declarations.
defineWorker({ fetch: () => Effect.map(Greeting, ({ text }) => new Response(text)) });

it.effect("accepts Effect handlers whose service requirements are satisfied", () =>
  Effect.gen(function* () {
    const worker = defineWorker({
      fetch: () =>
        Effect.map(Greeting, ({ text }) => new Response(text)).pipe(
          Effect.provideService(Greeting, { text: "hello" }),
        ),
    });
    const response = yield* Effect.promise(() =>
      worker.fetch(
        new Request("https://example.test"),
        {},
        { waitUntil: () => {}, passThroughOnException: () => {} },
      ),
    );
    expect(yield* Effect.promise(() => response.text())).toBe("hello");
  }),
);

import { kv } from "@carere/renkin/cloudflare";
import { workerReference } from "@carere/renkin/worker";

const cache = kv("cache");
const remote = workerReference<{ message(): Promise<string> }>("remote", { entrypoint: "Service" });
it.effect("resolves native and typed Effect clients once at the implementation boundary", () =>
  Effect.gen(function* () {
    let factories = 0;
    const implementation = defineWorker({ cache, remote }, ({ cache, remote }) => {
      factories++;
      return {
        fetch: () =>
          Effect.gen(function* () {
            const stored = yield* cache.get("key");
            const message = yield* remote.call((service) => service.message());
            return new Response(`${stored}:${message}`);
          }),
      };
    });
    const env = { cache: { get: async () => "value" }, remote: { message: async () => "rpc" } };
    for (let i = 0; i < 2; i++) {
      const response = yield* Effect.promise(() =>
        implementation.fetch(new Request("https://example.test"), env, {
          waitUntil: () => {},
          passThroughOnException: () => {},
        }),
      );
      expect(yield* Effect.promise(() => response.text())).toBe("value:rpc");
    }
    expect(factories).toBe(1);
  }),
);

// @ts-expect-error Resource inference must not discard unrelated Effect requirements.
defineWorker({ cache }, () => ({
  fetch: () => Effect.map(Greeting, ({ text }) => new Response(text)),
}));

const ordinaryReference = workerReference("ordinary");
defineWorker({ ordinary: ordinaryReference }, ({ ordinary }) => ({
  fetch: (request) => ordinary.call((service) => service.fetch(request)),
}));

import { queue, workflow } from "@carere/renkin/cloudflare";
import type { QueueBatch } from "@carere/renkin/worker";
import type { defineWorkflow, WorkflowEvent } from "@carere/renkin/workflow";
import { Layer } from "effect";

interface Job {
  readonly id: string;
}
const jobs = queue<Job>("Jobs");
const flow = workflow<Job>("Flow", { worker: "App", className: "Job" });
const background = defineWorker(
  { jobs, flow },
  ({ jobs, flow }) => ({
    scheduled: () =>
      Effect.gen(function* () {
        const greeting = yield* Greeting;
        yield* jobs.send({ id: greeting.text });
        // @ts-expect-error Queue body type is preserved through inferred client resolution.
        yield* jobs.send({ wrong: true });
      }),
    queue: (batch: QueueBatch<Job>) =>
      Effect.gen(function* () {
        for (const message of batch.messages) {
          yield* flow.create({ id: message.body.id, params: message.body });
          // @ts-expect-error Workflow parameter type is preserved through inferred client resolution.
          yield* flow.create({ params: { wrong: true } });
        }
      }),
  }),
  Layer.succeed(Greeting)({ text: "hello" }),
);

const workflowTypes = (define: typeof defineWorkflow) => {
  const run = (event: WorkflowEvent<Job>) =>
    Effect.map(Greeting, ({ text }) => ({ id: event.payload.id, text }));
  // @ts-expect-error Workflow application service requirements need a supplied layer.
  define({}, run);
  return define({}, run, Layer.succeed(Greeting)({ text: "hello" }));
};
it("keeps typed background clients and Workflow service requirements in the public API", () => {
  expect(background.queue).toBeTypeOf("function");
  expect(workflowTypes).toBeTypeOf("function");
});
