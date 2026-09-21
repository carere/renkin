import { resolve } from "node:path";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import type { Stack } from "@renkin/core/models/stack";
import { emptyState } from "@renkin/core/models/state";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import {
  type LocalWorker,
  startLocalWorker,
} from "@renkin/runtime/services/local/local-worker-service";
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
  const workers: Record<string, LocalWorker> = {};
  const close = async () => {
    await Promise.all(Object.values(workers).map((worker) => worker.close()));
    await lease.release();
  };
  try {
    const state = (await lease.read()) ?? emptyState(stack.name, environment);
    for (const resource of stack.resources) {
      if (resource.type !== "cloudflare.worker" || !("options" in resource))
        throw new Error("Unsupported local resource.");
      const worker = resource as WorkerResource;
      const localWorker = await startLocalWorker({
        ...worker.options,
        watch: options.watch ?? true,
        persist: resolve(directory, "data", stack.name, environment, resource.id),
        onReload: () => options.progress?.(`Reloaded ${resource.id}`),
        onError: (message) => options.progress?.(message),
      });
      workers[resource.id] = localWorker;
      state.outputs[resource.id] = { value: { url: localWorker.url } };
      options.progress?.(`${resource.id}: ${localWorker.url}`);
    }
    Object.assign(state.outputs, stack.outputs ?? {});
    await lease.write(state);
    return { workers, close };
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
