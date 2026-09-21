import { QueryClient } from "@tanstack/solid-query";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

export class GraphApi extends Context.Service<
  GraphApi,
  { fetch: (path: string, init?: RequestInit) => Effect.Effect<Response, Error> }
>()("full-graph/GraphApi") {}
export const createGraphContext = () => ({
  queryClient: new QueryClient(),
  runtime: ManagedRuntime.make(
    Layer.succeed(GraphApi, {
      fetch: (path, init) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(path, {
              ...init,
              headers: { authorization: "Bearer local-demo", ...init?.headers },
            });
            if (!response.ok) throw new Error(`Graph request failed (${response.status})`);
            return response;
          },
          catch: (error) => (error instanceof Error ? error : new Error("Graph request failed")),
        }),
    }),
  ),
});
export type GraphContext = ReturnType<typeof createGraphContext>;
