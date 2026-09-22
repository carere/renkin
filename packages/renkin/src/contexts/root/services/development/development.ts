import { resolve } from "node:path";
import { preparedMigrations } from "@renkin/cloudflare/services/d1/prepare-d1";
import {
  applyMigrations,
  MigrationError,
} from "@renkin/cloudflare/services/migrations/migration-service";
import { nativeD1MigrationExecutor } from "@renkin/cloudflare/services/migrations/native-d1-migration-executor";
import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import type { Stack } from "@renkin/core/models/stack";
import { type EnvironmentState, emptyState } from "@renkin/core/models/state";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import type { LocalR2S3Options } from "@renkin/runtime/models/local-r2-s3";
import { LocalWorkflowRecoveryError } from "@renkin/runtime/models/local-workflow-recovery-error";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { LocalR2RemovalError } from "@renkin/runtime/services/local/local-r2-removal";
import { Effect, Exit, Scope } from "effect";
import { frameworkSessions } from "./framework-sessions.ts";
import { prepareLocalResources } from "./local-resources.ts";
import { startupFailure, startupTrace } from "./startup-diagnostic.ts";

export interface DevelopmentOptions {
  readonly environment?: string;
  readonly directory?: string;
  readonly watch?: boolean;
  readonly r2S3?: LocalR2S3Options;
  readonly progress?: (message: string) => void;
}

const native = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: (error) => error });

const migrateDatabases = (stack: Stack, graph: Awaited<ReturnType<typeof startLocalGraph>>) =>
  Effect.gen(function* () {
    for (const resource of stack.resources) {
      if (resource.type !== "cloudflare.d1") continue;
      const database = yield* native(() => graph.database(resource.id));
      yield* applyMigrations(preparedMigrations(resource), nativeD1MigrationExecutor(database));
    }
  });

const announceOutputs = (
  state: EnvironmentState,
  stack: Stack,
  graph: Awaited<ReturnType<typeof startLocalGraph>>,
  options: DevelopmentOptions,
) => {
  for (const key of Object.keys(state.outputs)) delete state.outputs[key];
  for (const [id, localWorker] of Object.entries(graph.workers)) {
    state.outputs[id] = { value: { url: localWorker.url } };
    options.progress?.(`${id}: ${localWorker.url}`);
  }
  Object.assign(state.outputs, stack.outputs ?? {});
};

const start = (input: Stack, options: DevelopmentOptions, trace: ReturnType<typeof startupTrace>) =>
  Effect.gen(function* () {
    const directory = resolve(options.directory ?? ".renkin");
    const environment = options.environment ?? "local";
    const repository = new FileStateRepository(directory);
    const lease = yield* Effect.acquireRelease(
      trace.run("acquire-state", repository.acquire(input.name, environment)),
      (lease) => lease.release().pipe(Effect.orDie),
    );
    const frameworks = frameworkSessions();
    let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
    yield* Effect.addFinalizer(() =>
      frameworks
        .close()
        .pipe(Effect.orDie)
        .pipe(
          Effect.ensuring(
            Effect.promise(async () => {
              await graph?.close();
            }),
          ),
        ),
    );
    const prepared = yield* trace.run(
      "frameworks",
      frameworks.prepare(
        input,
        resolve(directory, "frameworks", input.name, environment),
        options.watch ?? true,
      ),
    );
    const stack = yield* trace.run("prepare-stack", prepareStack(prepared));
    const persist = resolve(directory, "data", stack.name, environment);
    const previous = yield* trace.run("read-state", lease.read());
    const { state, ...resources } = yield* trace.run(
      "prepare-resources",
      prepareLocalResources(stack, previous ?? emptyState(stack.name, environment), persist),
    );
    yield* trace.run("write-state", lease.write(state));
    graph = yield* trace.run(
      "start-runtime",
      native(() =>
        startLocalGraph({
          ...resources,
          ...(options.r2S3 ? { r2S3: options.r2S3 } : {}),
          persist,
          watch: options.watch ?? true,
          onReload: (id) => options.progress?.(`Reloaded ${id}`),
          onError: (message) => options.progress?.(message),
        }),
      ),
    );
    const activeGraph = graph;
    yield* trace.run("migrations", migrateDatabases(stack, activeGraph));
    yield* trace.run("connect-frameworks", frameworks.connect(activeGraph));
    announceOutputs(state, stack, graph, options);
    yield* trace.run("write-state", lease.write(state));
    return {
      workers: graph.workers,
      database: graph.database,
      bucket: graph.bucket,
      bindings: graph.bindings,
      capturedEmails: graph.capturedEmails,
    };
  });

const developmentError = (trace: ReturnType<typeof startupTrace>, error: unknown) =>
  error instanceof MigrationError ||
  error instanceof LocalR2RemovalError ||
  error instanceof LocalWorkflowRecoveryError ||
  (error instanceof Error && error.message.startsWith("Deletion protection"))
    ? error
    : startupFailure(trace.phase, error);

export const development = (stack: Stack, options: DevelopmentOptions = {}) =>
  Effect.suspend(() => {
    const trace = startupTrace();
    return Effect.acquireRelease(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const session = yield* start(stack, options, trace).pipe(
          Scope.provide(scope),
          Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
          Effect.mapError((error) => developmentError(trace, error)),
          Effect.catchDefect((error) => Effect.fail(developmentError(trace, error))),
        );
        const close = Scope.close(scope, Exit.void);
        return { session, close };
      }),
      (result) => result.close,
    ).pipe(
      Effect.map(({ session, close }) => ({
        ...session,
        // The application session's imperative close callback is an external API boundary.
        close: () => Effect.runPromise(close),
      })),
    );
  });
