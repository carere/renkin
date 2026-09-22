import { Effect } from "effect";
import { development } from "renkin";
import { graph } from "./graph.ts";

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const session = yield* development(graph(), {
        r2S3: { accessKeyId: "local-demo-key", secretAccessKey: "local-demo-secret" },
        progress: (message) => console.info(message),
      });
      console.info(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(session.workers).map(([id, worker]) => [id, worker.url]),
          ),
          null,
          2,
        ),
      );
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            process.once("SIGINT", () => resolve());
            process.once("SIGTERM", () => resolve());
          }),
      );
    }),
  ),
);
