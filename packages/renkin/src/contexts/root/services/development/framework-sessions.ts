import { resolve } from "node:path";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import { expandResources } from "@renkin/cloudflare/services/worker/expand-resources";
import type { Stack } from "@renkin/core/models/stack";
import type { WorkerDevelopmentSession } from "@renkin/runtime/models/worker-builder";
import type { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { Effect } from "effect";

export const frameworkSessions = () => {
  const sessions = new Map<string, WorkerDevelopmentSession>();
  return {
    close: () =>
      Effect.gen(function* () {
        const results = yield* Effect.forEach(
          [...sessions.values()],
          (item) =>
            Effect.tryPromise({ try: () => item.close(), catch: (error) => error }).pipe(
              Effect.exit,
            ),
          { concurrency: "unbounded" },
        );
        sessions.clear();
        for (const result of results) yield* result;
      }),
    prepare: (stack: Stack, directory: string, watch: boolean) =>
      Effect.gen(function* () {
        // Wait for every startup before cleanup, including sessions that finish after a peer fails.
        const results = yield* Effect.forEach(
          expandResources(stack.resources),
          (resource) =>
            Effect.gen(function* () {
              if (resource.type !== "cloudflare.worker" || !("options" in resource))
                return resource;
              const worker = resource as WorkerResource;
              const develop = worker.options.builder?.develop;
              if (!develop) return resource;
              const session = yield* Effect.tryPromise({
                try: () =>
                  develop({
                    directory: resolve(directory, resource.id),
                    watch,
                  }),
                catch: (error) => error,
              });
              sessions.set(resource.id, session);
              return { ...worker, options: { ...worker.options, build: session.build, port: 0 } };
            }).pipe(Effect.exit),
          { concurrency: "unbounded" },
        );
        return { ...stack, resources: yield* Effect.all(results) };
      }),
    connect: (graph: Awaited<ReturnType<typeof startLocalGraph>>) =>
      Effect.gen(function* () {
        for (const [id, session] of sessions) {
          yield* Effect.tryPromise({
            try: () =>
              session.connect({
                bindings: () => graph.bindings(id),
                dispatch: (request) => graph.dispatch(id, request),
              }),
            catch: (error) => error,
          });
          const original = graph.workers[id];
          if (!original)
            return yield* Effect.fail(
              new Error("Framework Worker is missing from the local graph."),
            );
          graph.workers[id] = {
            ...original,
            url: session.url,
            fetch: (path = "/", init) => fetch(new URL(path, session.url), init),
          };
        }
      }),
  };
};
