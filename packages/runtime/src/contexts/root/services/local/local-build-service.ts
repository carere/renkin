import { resolve } from "node:path";
import {
  convertV4MiniflareOptions,
  Miniflare,
  type V4MiniflareOptions as MiniflareOptions,
  type V4WorkerOptions,
} from "miniflare";
import type { WorkerBuildResult } from "#src/contexts/root/models/build-result.ts";
import { readBuildResult } from "#src/contexts/root/services/bundler/read-build-result.ts";
import { compatibilityDiagnostic } from "./compatibility-diagnostic.ts";
import type { LocalWorker } from "./local-worker-service.ts";

export const localAssetOptions = (
  build: WorkerBuildResult,
): Partial<Pick<V4WorkerOptions, "assets">> => {
  if (!build.assets) return {};
  const config = build.assets.config;
  const first = config?.runWorkerFirst;
  return {
    assets: {
      directory: resolve(build.assets.directory),
      binding: build.assets.binding ?? "ASSETS",
      routerConfig: { has_user_worker: true },
      ...(first === undefined
        ? {}
        : { run_worker_first: typeof first === "boolean" ? first : [...first] }),
      assetConfig: {
        ...(config?.htmlHandling ? { html_handling: config.htmlHandling } : {}),
        ...(config?.notFoundHandling ? { not_found_handling: config.notFoundHandling } : {}),
      },
    },
  };
};

/** Run the same external build artifact and asset routing locally without credentials. */
export const startLocalBuild = async (
  build: WorkerBuildResult,
  options: { readonly port?: number; readonly bindings?: Record<string, string> } = {},
): Promise<LocalWorker> => {
  const settings = async (): Promise<MiniflareOptions> => {
    const prepared = await readBuildResult(build);
    return {
      modulesRoot: "/renkin-build",
      modules: [
        {
          type: "ESModule",
          path: `/renkin-build/${prepared.mainModule}`,
          contents: prepared.source,
        },
        ...prepared.modules.map((module) => ({
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
      compatibilityDate: build.compatibilityDate ?? "2026-07-30",
      compatibilityFlags: [...(build.compatibilityFlags ?? ["nodejs_compat"])],
      bindings: options.bindings ?? {},
      host: "127.0.0.1",
      port: options.port ?? 0,
      ...localAssetOptions(build),
    };
  };
  const instance = new Miniflare(convertV4MiniflareOptions(await settings()));
  try {
    const url = String(await instance.ready);
    return {
      url,
      fetch: (path = "/", init) => fetch(new URL(path, url), init),
      scheduled: async (options) => (await instance.getWorker()).scheduled(options),
      reload: async () => {
        await instance.setOptions(convertV4MiniflareOptions(await settings()));
      },
      close: () => instance.dispose(),
    };
  } catch (error) {
    await instance.dispose();
    throw compatibilityDiagnostic(error) ?? error;
  }
};
