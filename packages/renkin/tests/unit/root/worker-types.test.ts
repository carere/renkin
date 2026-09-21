import { expect, it } from "@effect/vitest";
import { Context, Effect } from "effect";
import { defineWorker } from "renkin/worker";

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

import { kv } from "renkin/cloudflare";
import { workerReference } from "renkin/worker";

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
