import { type BuildContext, type BuildResult, context as buildContext } from "esbuild";
import { Miniflare, type WorkerOptions } from "miniflare";
import type { Requirements } from "../../models/binding.ts";
import { inspectRequirements } from "../bundler/inspect-requirements.ts";
import { bundleOptions, readBundle } from "../bundler/worker-bundler.ts";
import type { LocalWorker } from "./local-worker-service.ts";

export interface GraphWorker {
  readonly id: string;
  readonly entry: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly bindings?: Readonly<Record<string, string>>;
  readonly port?: number;
}
export interface LocalGraphOptions {
  readonly workers: readonly GraphWorker[];
  readonly namespaces: Readonly<Record<string, string>>;
  readonly persist: string;
  readonly watch?: boolean;
  readonly onReload?: (id: string) => void;
  readonly onError?: (message: string) => void;
}
interface PreparedWorker {
  readonly code: string;
  readonly requirements: Requirements;
}

const workerSettings = (
  worker: GraphWorker,
  prepared: PreparedWorker,
  options: LocalGraphOptions,
): WorkerOptions => {
  const kvNamespaces: Record<string, string> = {};
  const serviceBindings: Record<string, string | { name: string; entrypoint: string }> = {};
  for (const [binding, requirement] of Object.entries(prepared.requirements)) {
    if (requirement.type === "cloudflare.kv") {
      const namespace = options.namespaces[requirement.id];
      if (!namespace)
        throw new Error(`KV requirement ${requirement.id} is not declared in the stack.`);
      kvNamespaces[binding] = namespace;
    } else {
      const targetId = requirement.external
        ? `renkin-external-${requirement.external.name}`
        : requirement.id;
      if (!options.workers.some((target) => target.id === targetId))
        throw new Error(`Worker reference ${requirement.id} is not declared in the stack.`);
      serviceBindings[binding] = requirement.entrypoint
        ? { name: targetId, entrypoint: requirement.entrypoint }
        : targetId;
    }
  }
  return {
    name: worker.id,
    script: prepared.code,
    modules: true,
    compatibilityDate: worker.compatibilityDate,
    compatibilityFlags: [...(worker.compatibilityFlags ?? ["nodejs_compat"])],
    bindings: { ...worker.bindings },
    kvNamespaces,
    serviceBindings,
    unsafeDirectSockets: [{ host: "127.0.0.1", port: worker.port ?? 0 }],
  };
};

const watchContext = (worker: GraphWorker, onEnd: (result: BuildResult) => void | Promise<void>) =>
  buildContext({
    ...bundleOptions(worker.entry),
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

export const startLocalGraph = async (
  options: LocalGraphOptions,
): Promise<{ workers: Record<string, LocalWorker>; close: () => Promise<void> }> => {
  const graphWorkers = [...options.workers];
  options = { ...options, workers: graphWorkers };
  const contexts: BuildContext[] = [];
  const prepared: Record<string, PreparedWorker> = {};
  let runtime: Miniflare | undefined;
  const pending = Promise.resolve();
  const settings = () => ({
    host: "127.0.0.1",
    port: 0,
    defaultPersistRoot: options.persist,
    workers: options.workers.map((worker) => {
      const source = prepared[worker.id];
      if (!source) throw new Error("Worker has not built.");
      return workerSettings(worker, source, options);
    }),
  });
  const session: GraphSession = { runtime, prepared, pending, options, settings };
  const close = async () => {
    await Promise.all(contexts.map((context) => context.dispose()));
    await session.pending.catch(() => {});
    await runtime?.dispose();
  };
  try {
    for (const worker of options.workers) {
      const context = await watchContext(worker, reloader(worker, session));
      contexts.push(context);
      const code = readBundle(await context.rebuild()).code;
      prepared[worker.id] = {
        code,
        requirements: await inspectRequirements(
          code,
          worker.compatibilityDate,
          worker.compatibilityFlags,
        ),
      };
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
    runtime = new Miniflare(settings());
    session.runtime = runtime;
    await runtime.ready;
    const workers: Record<string, LocalWorker> = {};
    for (const [index, worker] of options.workers.entries()) {
      const url = String(await runtime.unsafeGetDirectURL(worker.id));
      workers[worker.id] = {
        url,
        fetch: (path = "/", init) => fetch(new URL(path, url), init),
        reload: async () => {
          await contexts[index]?.rebuild();
          await session.pending;
        },
        close: async () => {},
      };
    }
    if (options.watch) await Promise.all(contexts.map((context) => context.watch()));
    return { workers, close };
  } catch (error) {
    await close();
    throw error;
  }
};
