import { context as buildContext } from "esbuild";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { bundleOptions, readBundle } from "../bundler/worker-bundler.ts";

export interface LocalWorkerOptions {
  readonly entry: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly port?: number;
  readonly bindings?: Record<string, string>;
  readonly watch?: boolean;
  readonly persist?: string;
  readonly onReload?: () => void;
  readonly onError?: (message: string) => void;
}

export interface LocalWorker {
  readonly url: string;
  fetch(path?: string, init?: RequestInit): Promise<Response>;
  reload(): Promise<void>;
  close(): Promise<void>;
}

export const startLocalWorker = async (options: LocalWorkerOptions): Promise<LocalWorker> => {
  let instance: Miniflare | undefined;
  let pending = Promise.resolve();
  let currentCode: string | undefined;
  const settings = (script: string): MiniflareOptions => ({
    script,
    modules: true,
    host: "127.0.0.1",
    port: options.port ?? 0,
    compatibilityDate: options.compatibilityDate,
    compatibilityFlags: [...(options.compatibilityFlags ?? ["nodejs_compat"])],
    bindings: options.bindings ?? {},
    ...(options.persist ? { defaultPersistRoot: options.persist } : {}),
  });
  const context = await buildContext({
    ...bundleOptions(options.entry),
    plugins: [
      {
        name: "renkin-reload",
        setup(build) {
          build.onEnd((result) => {
            if (!instance) return;
            if (result.errors.length) {
              options.onError?.("Worker build failed; the last successful build is still running.");
              return;
            }
            const script = readBundle(result).code;
            if (script === currentCode) return;
            pending = pending
              .catch(() => {})
              .then(async () => {
                await instance?.setOptions(settings(script));
                currentCode = script;
                options.onReload?.();
              });
            return pending.catch(() => {
              options.onError?.("Worker reload failed.");
            });
          });
        },
      },
    ],
  });
  try {
    currentCode = readBundle(await context.rebuild()).code;
    instance = new Miniflare(settings(currentCode));
    const url = String(await instance.ready);
    if (options.watch) await context.watch();
    return {
      url,
      fetch: async (path = "/", init) => fetch(new URL(path, url), init),
      reload: async () => {
        await context.rebuild();
        await pending;
      },
      close: async () => {
        try {
          await context.dispose();
        } finally {
          await pending.catch(() => {});
          await instance?.dispose();
        }
      },
    };
  } catch (error) {
    try {
      await context.dispose();
    } finally {
      await instance?.dispose();
    }
    throw error;
  }
};
