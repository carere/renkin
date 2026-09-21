import { resolve } from "node:path";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import type { AssetRouting, WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { BuildReuseOptions } from "@renkin/runtime/models/build-reuse";
import { frameworkStartup } from "./framework-startup.ts";
import { type FrameworkWorkerOptions, frameworkWorker } from "./framework-worker.ts";

export interface TanStackOptions extends FrameworkWorkerOptions {
  readonly root: string;
  readonly reuse?: BuildReuseOptions | false;
  readonly rendering: "spa" | "ssr";
  readonly configFile?: string;
  readonly serverEntry?: string;
  readonly sourceMap?: boolean | "inline" | "hidden";
  readonly buildEnvironment?: Readonly<Record<string, string>>;
  readonly assets?: AssetRouting;
  readonly beforeBuild?: () => void | Promise<void>;
  readonly afterBuild?: (result: WorkerBuildResult) => void | Promise<void>;
}

export interface TanStackResource extends WorkerResource {
  readonly website: TanStackOptions;
}

/** Host build modules load by URL so Worker bundlers never traverse native tooling. */
export const tanstackStart = (id: string, options: TanStackOptions): TanStackResource => {
  const website = { ...options, root: resolve(options.root) };
  return {
    ...frameworkWorker(id, website, {
      build: async (context) => {
        const moduleUrl = new URL("../services/tanstack/build-tanstack.ts", import.meta.url);
        const { buildTanStack } = (await import(
          moduleUrl.href
        )) as typeof import("#src/contexts/root/services/tanstack/build-tanstack.ts");
        return buildTanStack(website, context);
      },
      develop: async (context) => {
        const moduleUrl = new URL("../services/tanstack/develop-tanstack.ts", import.meta.url);
        const { developTanStack } = (await frameworkStartup(
          "load-tanstack-development",
          () => import(moduleUrl.href),
        )) as typeof import("#src/contexts/root/services/tanstack/develop-tanstack.ts");
        return frameworkStartup("invoke-tanstack-development", () =>
          developTanStack(website, context),
        );
      },
    }),
    website,
  };
};
