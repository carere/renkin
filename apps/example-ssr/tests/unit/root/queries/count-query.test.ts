import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { countQuery } from "#src/contexts/root/queries/count-query.ts";
import { createApplicationContext } from "#src/contexts/shared/context/application-context.ts";
import { InMemoryCounterService } from "#test-support/root/services/counter/in-memory-counter-service.ts";

it("keeps request runtimes and query caches isolated while reusing loader results", async () => {
  const firstService = new InMemoryCounterService();
  const secondService = new InMemoryCounterService();
  firstService.result = Effect.succeed({ value: 1, stage: "first" });
  secondService.result = Effect.succeed({ value: 2, stage: "second" });
  const first = createApplicationContext(firstService.layer);
  const second = createApplicationContext(secondService.layer);
  try {
    expect(first.runtime).not.toBe(second.runtime);
    await first.queryClient.fetchQuery(countQuery(first.runtime));
    await first.queryClient.fetchQuery({ ...countQuery(first.runtime), staleTime: Infinity });
    expect(firstService.reads).toBe(1);
    expect(second.queryClient.getQueryData(["counter"])).toBeUndefined();
    expect(await second.queryClient.fetchQuery(countQuery(second.runtime))).toEqual({
      value: 2,
      stage: "second",
    });
    expect(first.queryClient.getQueryData(["counter"])).toEqual({ value: 1, stage: "first" });
  } finally {
    await first.dispose();
    await second.dispose();
  }
  expect(first.queryClient.getQueryCache().getAll()).toEqual([]);
});

it("interrupts a pending API read when its query is cancelled or the request is disposed", async () => {
  for (const ending of ["cancel", "dispose"]) {
    const service = new InMemoryCounterService();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let interrupted = false;
    service.result = Effect.gen(function* () {
      started();
      return yield* Effect.never;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    );
    const context = createApplicationContext(service.layer);
    const pending = context.queryClient.fetchQuery(countQuery(context.runtime));
    const rejected = expect(pending).rejects.toBeDefined();
    await ready;
    if (ending === "cancel") await context.queryClient.cancelQueries({ queryKey: ["counter"] });
    await context.dispose();
    await rejected;
    expect(interrupted).toBe(true);
  }
});
