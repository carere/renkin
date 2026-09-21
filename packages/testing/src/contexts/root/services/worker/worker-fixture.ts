import {
  type LocalWorkerOptions,
  startLocalWorker,
} from "@renkin/runtime/services/local/local-worker-service";
import { Effect } from "effect";

/** A real workerd fixture, closed with the Effect scope. No provider credentials required. */
export const workerFixture = (options: LocalWorkerOptions) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => startLocalWorker(options),
      catch: () => new Error("Local Worker could not start."),
    }),
    (worker) => Effect.promise(() => worker.close()),
  );
