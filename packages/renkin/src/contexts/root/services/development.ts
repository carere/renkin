import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import type { Stack } from "@renkin/core/models/stack";
import { emptyState } from "@renkin/core/models/state";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import { plan } from "@renkin/core/use-cases/plan";
import { renamedState } from "@renkin/core/use-cases/rename";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { Effect } from "effect";

export interface DevelopmentOptions {
  readonly environment?: string;
  readonly directory?: string;
  readonly watch?: boolean;
  readonly progress?: (message: string) => void;
}

const start = async (stack: Stack, options: DevelopmentOptions) => {
  const directory = resolve(options.directory ?? ".renkin");
  const environment = options.environment ?? "local";
  const repository = new FileStateRepository(directory);
  const lease = await repository.acquire(stack.name, environment);
  let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
  const close = async () => {
    try {
      await graph?.close();
    } finally {
      await lease.release();
    }
  };
  try {
    let state = (await lease.read()) ?? emptyState(stack.name, environment);
    plan(stack, state);
    state = renamedState(stack, state);
    const namespaces: Record<string, string> = {};
    const workerResources: WorkerResource[] = [];
    for (const resource of stack.resources) {
      const previous = state.resources[resource.id];
      state.resources[resource.id] = {
        definition: resource,
        physicalId: previous?.physicalId ?? randomUUID(),
        outputs: previous?.outputs ?? null,
        ownershipId: previous?.ownershipId ?? resource.id,
      };
      if (resource.type === "cloudflare.kv")
        namespaces[resource.id] = state.resources[resource.id]?.physicalId ?? resource.id;
      else if (resource.type === "cloudflare.worker" && "options" in resource)
        workerResources.push(resource as WorkerResource);
      else throw new Error("Unsupported local resource.");
    }
    for (const id of Object.keys(state.resources))
      if (!stack.resources.some((resource) => resource.id === id)) delete state.resources[id];
    await lease.write(state);
    graph = await startLocalGraph({
      workers: workerResources.map((resource) => ({ id: resource.id, ...resource.options })),
      namespaces,
      persist: resolve(directory, "data", stack.name, environment),
      watch: options.watch ?? true,
      onReload: (id) => options.progress?.(`Reloaded ${id}`),
      onError: (message) => options.progress?.(message),
    });
    for (const key of Object.keys(state.outputs)) delete state.outputs[key];
    for (const [id, localWorker] of Object.entries(graph.workers)) {
      state.outputs[id] = { value: { url: localWorker.url } };
      options.progress?.(`${id}: ${localWorker.url}`);
    }
    Object.assign(state.outputs, stack.outputs ?? {});
    await lease.write(state);
    return { workers: graph.workers, close };
  } catch (error) {
    await close();
    throw error;
  }
};

export const development = (stack: Stack, options: DevelopmentOptions = {}) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => start(stack, options),
      catch: () => new Error("Local application startup failed."),
    }),
    (session) => Effect.promise(() => session.close()),
  );
