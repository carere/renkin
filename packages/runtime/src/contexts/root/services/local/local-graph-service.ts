import { type FSWatcher, watch } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type BuildContext, type BuildResult, context as buildContext } from "esbuild";
import { Miniflare, type WorkerOptions } from "miniflare";
import type { Requirements, WorkerRequirement } from "../../models/binding.ts";
import type { WorkerBuildResult } from "../../models/build-result.ts";
import type { NativeD1 } from "../../models/d1.ts";
import type { LocalR2S3Options } from "../../models/local-r2-s3.ts";
import type { NativeR2 } from "../../models/r2.ts";
import { inspectRequirements } from "../bundler/inspect-requirements.ts";
import { readBuildResult } from "../bundler/read-build-result.ts";
import { bundleOptions, readBundle } from "../bundler/worker-bundler.ts";
import {
  capturedEmails,
  type LocalBackgroundOptions,
  type LocalQueueConsumer,
  localBackgroundOptions,
  workflowNames,
} from "./local-background.ts";
import { localAssetOptions } from "./local-build-service.ts";
import { type LocalDurableObject, localDurableObjects } from "./local-durable-objects.ts";
import { graphBindings } from "./local-graph-bindings.ts";
import { graphDispatcher } from "./local-graph-dispatch.ts";
import {
  localR2Credentials,
  localR2GatewayName,
  localR2Source,
  localR2Workers,
} from "./local-r2-service.ts";
import type { LocalWorker } from "./local-worker-service.ts";
import { type WorkflowJournal, workflowJournal } from "./workflow-journal.ts";
import { recoverWorkflows, workflowRecoveryWorker } from "./workflow-recovery.ts";

export interface GraphWorker {
  readonly id: string;
  readonly entry?: string;
  readonly build?: WorkerBuildResult;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly bindings?: Readonly<Record<string, string>>;
  readonly port?: number;
  readonly consumers?: readonly LocalQueueConsumer[];
}
export interface LocalGraphOptions extends LocalBackgroundOptions {
  readonly workers: readonly GraphWorker[];
  readonly namespaces: Readonly<Record<string, string>>;
  readonly persist: string;
  readonly databases?: Readonly<Record<string, string>>;
  readonly durableObjects?: Readonly<Record<string, LocalDurableObject>>;
  readonly buckets?: Readonly<Record<string, string>>;
  readonly r2S3?: LocalR2S3Options;
  readonly r2Tokens?: Readonly<Record<string, readonly string[]>>;
  readonly watch?: boolean;
  readonly onReload?: (id: string) => void;
  readonly onError?: (message: string) => void;
}
interface PreparedWorker {
  readonly code: string;
  readonly requirements: Requirements;
  readonly artifact?: Awaited<ReturnType<typeof readBuildResult>>;
}

const serviceTarget = (requirement: WorkerRequirement<unknown>, options: LocalGraphOptions) => {
  const targetId = requirement.external
    ? `renkin-external-${requirement.external.name}`
    : requirement.id;
  if (!options.workers.some((target) => target.id === targetId))
    throw new Error(`Worker reference ${requirement.id} is not declared in the stack.`);
  return requirement.entrypoint ? { name: targetId, entrypoint: requirement.entrypoint } : targetId;
};

const workerSettings = (
  worker: GraphWorker,
  prepared: PreparedWorker,
  options: LocalGraphOptions,
  journal: WorkflowJournal,
): WorkerOptions => {
  const credentialBindings: Record<string, string> = {};
  const kvNamespaces: Record<string, string> = {};
  const d1Databases: Record<string, string> = {};
  const r2Buckets: Record<string, string> = {};
  const serviceBindings: Record<string, string | { name: string; entrypoint: string }> = {};
  for (const [binding, requirement] of Object.entries(prepared.requirements)) {
    if (requirement.type === "cloudflare.kv") {
      const namespace = options.namespaces[requirement.id];
      if (!namespace)
        throw new Error(`KV requirement ${requirement.id} is not declared in the stack.`);
      kvNamespaces[binding] = namespace;
    } else if (requirement.type === "cloudflare.d1") {
      const database = options.databases?.[requirement.id];
      if (!database)
        throw new Error(`D1 requirement ${requirement.id} is not declared in the stack.`);
      d1Databases[binding] = database;
    } else if (requirement.type === "cloudflare.r2-token") {
      credentialBindings[binding] = JSON.stringify(localR2Credentials(options, requirement.id));
    } else if (requirement.type === "cloudflare.r2") {
      const bucket = options.buckets?.[requirement.id];
      if (!bucket)
        throw new Error(`R2 requirement ${requirement.id} is not declared in the stack.`);
      r2Buckets[binding] = bucket;
    } else if (requirement.type === "cloudflare.worker-reference") {
      serviceBindings[binding] = serviceTarget(requirement, options);
    }
  }
  return {
    ...localBackgroundOptions(prepared.requirements, worker.consumers ?? [], options),
    name: worker.id,
    ...(prepared.artifact
      ? {
          modulesRoot: "/renkin-build",
          modules: [
            {
              type: "ESModule" as const,
              path: `/renkin-build/${prepared.artifact.mainModule}`,
              contents: prepared.code,
            },
            ...prepared.artifact.modules.map((module) => ({
              type:
                module.type === "application/wasm"
                  ? ("CompiledWasm" as const)
                  : module.type === "text/plain"
                    ? ("Text" as const)
                    : module.type === "application/octet-stream"
                      ? ("Data" as const)
                      : ("ESModule" as const),
              path: `/renkin-build/${module.name}`,
              contents: Buffer.from(module.content, "base64"),
            })),
          ],
        }
      : { script: prepared.code, modules: true }),
    ...(worker.build ? localAssetOptions(worker.build) : {}),
    compatibilityDate: worker.compatibilityDate,
    compatibilityFlags: [...(worker.compatibilityFlags ?? ["nodejs_compat"])],
    bindings: {
      ...worker.bindings,
      ...credentialBindings,
      __RENKIN_WORKFLOW_NAMES: workflowNames(prepared.requirements, options),
    },
    kvNamespaces,
    d1Databases,
    r2Buckets,
    serviceBindings: { ...serviceBindings, __RENKIN_WORKFLOW_JOURNAL: journal.fetch },
    ...localDurableObjects(prepared.requirements, options.durableObjects ?? {}),
    unsafeDirectSockets: [{ host: "127.0.0.1", port: options.r2S3 ? 0 : (worker.port ?? 0) }],
  };
};

const watchContext = (worker: GraphWorker, onEnd: (result: BuildResult) => void | Promise<void>) =>
  buildContext({
    ...bundleOptions(worker.entry ?? ""),
    plugins: [
      {
        name: "renkin-graph-reload",
        setup(build) {
          build.onEnd(onEnd);
        },
      },
    ],
  });

interface GraphSession {
  runtime: Miniflare | undefined;
  prepared: Record<string, PreparedWorker>;
  pending: Promise<void>;
  options: LocalGraphOptions;
  journal: WorkflowJournal;
  settings: () => {
    workers: WorkerOptions[];
    host: string;
    port: number;
    defaultPersistRoot: string;
  };
}
const reloader = (worker: GraphWorker, session: GraphSession) => (result: BuildResult) => {
  if (!session.runtime) return;
  if (result.errors.length) {
    session.options.onError?.("Worker build failed; the last successful graph is still running.");
    return;
  }
  const code = readBundle(result).code;
  if (session.prepared[worker.id]?.code === code) return;
  session.pending = session.pending
    .catch(() => {})
    .then(async () => {
      const previous = session.prepared[worker.id];
      try {
        const requirements = await inspectRequirements(
          code,
          worker.compatibilityDate,
          worker.compatibilityFlags,
        );
        session.prepared[worker.id] = { code, requirements };
        await session.runtime?.setOptions(session.settings());
        if (session.runtime)
          await recoverWorkflows(session.runtime, session.options.workflows ?? {}, session.journal);
        session.options.onReload?.(worker.id);
      } catch (error) {
        if (previous) session.prepared[worker.id] = previous;
        throw error;
      }
    });
  return session.pending.catch(() => {
    session.options.onError?.("Worker graph reload failed; inspect the resource requirements.");
  });
};

const prepareArtifact = async (worker: GraphWorker): Promise<PreparedWorker> => {
  if (!worker.build) throw new Error("Missing external build artifact.");
  const artifact = await readBuildResult(worker.build);
  return {
    code: artifact.source,
    artifact,
    requirements: await inspectRequirements(
      artifact.source,
      worker.build.compatibilityDate ?? worker.compatibilityDate,
      worker.build.compatibilityFlags ?? worker.compatibilityFlags,
      artifact,
    ),
  };
};
const reloadArtifact = (worker: GraphWorker, session: GraphSession): Promise<void> => {
  session.pending = session.pending
    .catch(() => {})
    .then(async () => {
      const previous = session.prepared[worker.id];
      try {
        session.prepared[worker.id] = await prepareArtifact(worker);
        await session.runtime?.setOptions(session.settings());
        if (session.runtime)
          await recoverWorkflows(session.runtime, session.options.workflows ?? {}, session.journal);
        session.options.onReload?.(worker.id);
      } catch (error) {
        if (previous) session.prepared[worker.id] = previous;
        throw error;
      }
    });
  return session.pending;
};

const prepareGraph = async (
  options: LocalGraphOptions,
  graphWorkers: GraphWorker[],
  prepared: Record<string, PreparedWorker>,
  contexts: Map<string, BuildContext>,
  session: GraphSession,
) => {
  for (const worker of options.workers) {
    if (worker.build) prepared[worker.id] = await prepareArtifact(worker);
    else {
      if (!worker.entry) throw new Error("Worker requires an entry or external build artifact.");
      const context = await watchContext(worker, reloader(worker, session));
      contexts.set(worker.id, context);
      const code = readBundle(await context.rebuild()).code;
      prepared[worker.id] = {
        code,
        requirements: await inspectRequirements(
          code,
          worker.compatibilityDate,
          worker.compatibilityFlags,
        ),
      };
    }
    for (const requirement of Object.values(prepared[worker.id]?.requirements ?? {})) {
      if (requirement.type !== "cloudflare.worker-reference" || !requirement.external) continue;
      const id = `renkin-external-${requirement.external.name}`;
      if (!requirement.external.localEntry)
        throw new Error("External Workers require localEntry for credential-free development.");
      if (!graphWorkers.some((target) => target.id === id))
        graphWorkers.push({
          id,
          entry: requirement.external.localEntry,
          compatibilityDate: worker.compatibilityDate,
          compatibilityFlags: worker.compatibilityFlags ?? ["nodejs_compat"],
        });
    }
  }
};

const watchGraph = async (
  options: LocalGraphOptions,
  contexts: Map<string, BuildContext>,
  watchers: FSWatcher[],
  session: GraphSession,
) => {
  if (options.watch) {
    await Promise.all([...contexts.values()].map((context) => context.watch()));
    for (const worker of options.workers)
      if (worker.build)
        for (const path of new Set([
          dirname(worker.build.entry),
          ...(worker.build.assets ? [worker.build.assets.directory] : []),
        ]))
          watchers.push(
            watch(path, { recursive: true }, () => {
              void reloadArtifact(worker, session).catch(() =>
                options.onError?.("External build reload failed."),
              );
            }),
          );
  }
};

const exposedWorkers = async (
  session: GraphSession,
  contexts: ReadonlyMap<string, BuildContext>,
  declaredWorkers: ReadonlySet<string>,
) => {
  const runtime = session.runtime;
  if (!runtime) throw new Error("Local graph is not running.");
  const workers: Record<string, LocalWorker> = {};
  for (const worker of session.options.workers) {
    if (!declaredWorkers.has(worker.id)) continue;
    const url = String(
      await runtime.unsafeGetDirectURL(
        session.options.r2S3 ? localR2GatewayName(worker.id) : worker.id,
      ),
    );
    workers[worker.id] = {
      url,
      fetch: (path = "/", init) => fetch(new URL(path, url), init),
      reload: async () => {
        if (worker.build) await reloadArtifact(worker, session);
        else await contexts.get(worker.id)?.rebuild();
        await session.pending;
      },
      scheduled: async (options) => (await runtime.getWorker(worker.id)).scheduled(options),
      close: async () => {},
    };
  }
  return workers;
};

const closeGraph = async (
  watchers: readonly FSWatcher[],
  contexts: ReadonlyMap<string, BuildContext>,
  session: GraphSession,
  journal: WorkflowJournal,
  emailDirectory: string,
) => {
  for (const watcher of watchers) watcher.close();
  await Promise.all([...contexts.values()].map((context) => context.dispose()));
  await session.pending.catch(() => {});
  await session.runtime?.dispose();
  await journal.settled();
  await rm(emailDirectory, { recursive: true, force: true });
};

export const startLocalGraph = async (
  options: LocalGraphOptions,
): Promise<{
  workers: Record<string, LocalWorker>;
  database: (id: string) => Promise<NativeD1>;
  bucket: (id: string) => Promise<NativeR2>;
  bindings: (workerId: string) => Promise<Record<string, unknown>>;
  dispatch: (workerId: string, request: Request) => Promise<Response>;
  close: () => Promise<void>;
  capturedEmails: () => Promise<readonly string[]>;
}> => {
  const journal = await workflowJournal(
    options.persist,
    Object.values(options.workflows ?? {}).map((flow) => flow.name),
  );
  const emailDirectory = await mkdtemp(join(tmpdir(), "renkin-email-"));
  const declaredWorkers = new Set(options.workers.map((worker) => worker.id));
  const graphWorkers = [...options.workers];
  options = { ...options, workers: graphWorkers };
  const contexts = new Map<string, BuildContext>();
  const watchers: FSWatcher[] = [];
  const prepared: Record<string, PreparedWorker> = {};
  let runtime: Miniflare | undefined;
  const r2Source = await localR2Source(options.r2S3);
  const settings = () => ({
    host: "127.0.0.1",
    port: 0,
    defaultPersistRoot: options.persist,
    defaultProjectTmpPath: emailDirectory,
    workers: [
      ...(Object.keys(options.workflows ?? {}).length
        ? [workflowRecoveryWorker(options.workflows ?? {})]
        : []),
      ...localR2Workers(options, prepared, r2Source),
      ...options.workers.map((worker) => {
        const source = prepared[worker.id];
        if (!source) throw new Error("Worker has not built.");
        return workerSettings(worker, source, options, journal);
      }),
      ...(options.databases && Object.keys(options.databases).length
        ? [
            {
              name: "__renkin_databases",
              script: "export default {fetch(){return new Response(null,{status:404})}}",
              modules: true as const,
              compatibilityDate: "2026-07-30",
              d1Databases: { ...options.databases },
            },
          ]
        : []),
    ],
  });
  const session: GraphSession = {
    runtime,
    prepared,
    pending: Promise.resolve(),
    options,
    journal,
    settings,
  };
  const close = () => closeGraph(watchers, contexts, session, journal, emailDirectory);
  try {
    await prepareGraph(options, graphWorkers, prepared, contexts, session);
    runtime = new Miniflare(settings());
    session.runtime = runtime;
    await runtime.ready;
    await recoverWorkflows(runtime, options.workflows ?? {}, journal);
    await watchGraph(options, contexts, watchers, session);
    return {
      workers: await exposedWorkers(session, contexts, declaredWorkers),
      close,
      dispatch: graphDispatcher(runtime, declaredWorkers, Boolean(options.r2S3)),
      capturedEmails: () => capturedEmails(emailDirectory),
      ...graphBindings(runtime, prepared, options.databases, options.buckets),
    };
  } catch (error) {
    await close();
    throw error;
  }
};
