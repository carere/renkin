import { resolve } from "node:path";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import { expandResources } from "@renkin/cloudflare/services/worker/expand-resources";
import type { Stack } from "@renkin/core/models/stack";
import type { WorkerDevelopmentSession } from "@renkin/runtime/models/worker-builder";
import type { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";

export const frameworkSessions = () => {
  const sessions = new Map<string, WorkerDevelopmentSession>();
  return {
    close: async () => {
      const results = await Promise.allSettled([...sessions.values()].map((item) => item.close()));
      sessions.clear();
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
    prepare: async (stack: Stack, directory: string, watch: boolean): Promise<Stack> => {
      const results = await Promise.allSettled(
        expandResources(stack.resources).map(async (resource) => {
          if (resource.type !== "cloudflare.worker" || !("options" in resource)) return resource;
          const worker = resource as WorkerResource;
          if (!worker.options.builder?.develop) return resource;
          const session = await worker.options.builder.develop({
            directory: resolve(directory, resource.id),
            watch,
          });
          sessions.set(resource.id, session);
          return { ...worker, options: { ...worker.options, build: session.build, port: 0 } };
        }),
      );
      return {
        ...stack,
        resources: results.map((result) => {
          if (result.status === "rejected") throw result.reason;
          return result.value;
        }),
      };
    },
    connect: async (graph: Awaited<ReturnType<typeof startLocalGraph>>) => {
      for (const [id, session] of sessions) {
        await session.connect({
          bindings: () => graph.bindings(id),
          dispatch: (request) => graph.dispatch(id, request),
        });
        const original = graph.workers[id];
        if (!original) throw new Error("Framework Worker is missing from the local graph.");
        graph.workers[id] = {
          ...original,
          url: session.url,
          fetch: (path = "/", init) => fetch(new URL(path, session.url), init),
        };
      }
    },
  };
};
