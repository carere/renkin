import { workerFixture } from "@carere/renkin/testing";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

for (const implementation of ["ordinary", "effect"]) {
  it.effect(`executes the ${implementation} consumer through public testing entrypoint`, () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture({
        entry: new URL(`../../fixtures/worker/${implementation}.ts`, import.meta.url).pathname,
        compatibilityDate: "2026-07-30",
      });
      const response = yield* Effect.promise(() => worker.fetch("/hello"));
      expect(yield* Effect.promise(() => response.text())).toBe(`${implementation}:/hello`);
    }),
  );
}
