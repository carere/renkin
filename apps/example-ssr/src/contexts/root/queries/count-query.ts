import { queryOptions } from "@tanstack/solid-query";
import { Effect } from "effect";
import { CounterService } from "#src/contexts/root/services/counter/counter-service.ts";
import type { ApplicationContext } from "#src/contexts/shared/context/application-context.ts";

export const countQuery = (runtime: ApplicationContext["runtime"]) =>
  queryOptions({
    queryKey: ["counter"],
    queryFn: ({ signal }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const counter = yield* CounterService;
          return yield* counter.read;
        }),
        { signal },
      ),
    throwOnError: true,
  });
