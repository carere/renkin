import { Effect, Layer } from "effect";
import { readCount } from "#src/contexts/root/server/read-count.ts";
import { CounterService } from "./counter-service.ts";

export const ServerCounterService = Layer.succeed(CounterService, {
  read: Effect.tryPromise({
    try: (signal) => readCount({ signal }),
    catch: (cause) => (cause instanceof Error ? cause : new Error("Could not read the counter")),
  }),
});
