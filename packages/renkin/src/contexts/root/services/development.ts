import { resolve } from "node:path";
import { preparedMigrations } from "@renkin/cloudflare/services/d1/prepare-d1";
import {
  applyMigrations,
  MigrationError,
} from "@renkin/cloudflare/services/migrations/migration-service";
import { nativeD1MigrationExecutor } from "@renkin/cloudflare/services/migrations/native-d1-migration-executor";
import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import type { Stack } from "@renkin/core/models/stack";
import { emptyState } from "@renkin/core/models/state";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import type { LocalR2S3Options } from "@renkin/runtime/models/local-r2-s3";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { LocalR2RemovalError } from "@renkin/runtime/services/local/local-r2-removal";
import { LocalWorkflowRecoveryError } from "@renkin/runtime/services/local/workflow-recovery";
import { Effect } from "effect";
import { frameworkSessions } from "./development/framework-sessions.ts";
import { prepareLocalResources } from "./development/local-resources.ts";

export interface DevelopmentOptions {
  readonly environment?: string;
  readonly directory?: string;
  readonly watch?: boolean;
  readonly r2S3?: LocalR2S3Options;
  readonly progress?: (message: string) => void;
}

const migrateDatabases = async (
  stack: Stack,
  graph: Awaited<ReturnType<typeof startLocalGraph>>,
) => {
  for (const resource of stack.resources) {
    if (resource.type !== "cloudflare.d1") continue;
    await Effect.runPromise(
      applyMigrations(
        preparedMigrations(resource),
        nativeD1MigrationExecutor(await graph.database(resource.id)),
      ),
    );
  }
};

const start = async (input: Stack, options: DevelopmentOptions) => {
  const directory = resolve(options.directory ?? ".renkin");
  const environment = options.environment ?? "local";
  const repository = new FileStateRepository(directory);
  const lease = await repository.acquire(input.name, environment);
  const frameworks = frameworkSessions();
  let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
  const close = async () => {
    try {
      try {
        await frameworks.close();
      } finally {
        await graph?.close();
      }
    } finally {
      await lease.release();
    }
  };
  try {
    const stack = await prepareStack(
      await frameworks.prepare(
        input,
        resolve(directory, "frameworks", input.name, environment),
        options.watch ?? true,
      ),
    );
    const persist = resolve(directory, "data", stack.name, environment);
    const { state, ...resources } = await prepareLocalResources(
      stack,
      (await lease.read()) ?? emptyState(stack.name, environment),
      persist,
    );
    await lease.write(state);
    graph = await startLocalGraph({
      ...resources,
      ...(options.r2S3 ? { r2S3: options.r2S3 } : {}),
      persist,
      watch: options.watch ?? true,
      onReload: (id) => options.progress?.(`Reloaded ${id}`),
      onError: (message) => options.progress?.(message),
    });
    await migrateDatabases(stack, graph);
    await frameworks.connect(graph);
    for (const key of Object.keys(state.outputs)) delete state.outputs[key];
    for (const [id, localWorker] of Object.entries(graph.workers)) {
      state.outputs[id] = { value: { url: localWorker.url } };
      options.progress?.(`${id}: ${localWorker.url}`);
    }
    Object.assign(state.outputs, stack.outputs ?? {});
    await lease.write(state);
    return {
      workers: graph.workers,
      database: graph.database,
      bucket: graph.bucket,
      bindings: graph.bindings,
      capturedEmails: graph.capturedEmails,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};

export const development = (stack: Stack, options: DevelopmentOptions = {}) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => start(stack, options),
      catch: (error) =>
        error instanceof MigrationError ||
        error instanceof LocalR2RemovalError ||
        error instanceof LocalWorkflowRecoveryError ||
        (error instanceof Error && error.message.startsWith("Deletion protection"))
          ? error
          : new Error("Local application startup failed."),
    }),
    (session) => Effect.promise(() => session.close()),
  );
