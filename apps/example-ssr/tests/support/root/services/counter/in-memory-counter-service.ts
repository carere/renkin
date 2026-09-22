import { Effect, Layer } from "effect";
import { type Count, CounterService } from "#src/contexts/root/services/counter/counter-service.ts";

export class InMemoryCounterService {
  result: Effect.Effect<Count, Error> = Effect.succeed({ value: 0, stage: "test" });
  reads = 0;
  readonly layer = Layer.succeed(CounterService, {
    read: Effect.suspend(() => {
      this.reads++;
      return this.result;
    }),
  });
}
