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
