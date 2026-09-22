import { dirname, relative, resolve } from "node:path";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { WorkerBuildContext } from "@renkin/runtime/models/build-reuse";
import { createBuildContext } from "@renkin/runtime/services/build-reuse/build-context";
import { type AstroConfig, build } from "astro";
import type { AstroBuildOptions } from "#src/contexts/root/models/astro-options.ts";
import { buildIdentity } from "#src/contexts/root/services/build/reuse-options.ts";
import { buildConfiguration } from "./build-configuration.ts";
import { assetDirectory, buildResult } from "./build-result.ts";

/** Runs the official adapter. High-level bindings attach after page generation. */
const runBuild = async (
  options: AstroBuildOptions,
  context: { readonly directory?: string } = {},
): Promise<WorkerBuildResult> => {
  const configuration = await buildConfiguration(options, context);
  let resolvedConfig: AstroConfig | undefined;
  let clientDirectory: string | undefined;
  await build({
    logLevel: "silent",
    ...configuration,
    ...(options.configFile === undefined
      ? {}
      : {
          configFile:
            options.configFile === false
              ? false
              : relative(options.root, resolve(options.root, options.configFile)),
        }),
    integrations: [
      ...(options.config?.integrations ?? []),
      {
        name: "renkin:astro-build",
        hooks: {
          "astro:config:done": ({ config }) => {
            resolvedConfig = config;
            clientDirectory = assetDirectory(config);
          },
        },
      },
    ],
  });
  if (!resolvedConfig) throw new Error("Astro did not produce a resolved build configuration.");
  return buildResult(options, resolvedConfig, clientDirectory);
};

// Astro's official adapter shares compiler/runtime setup within the process.
// Overlapping builds can close another build's prerender dispatcher.
let previousBuild: Promise<unknown> = Promise.resolve();

export const buildAstro = (
  options: AstroBuildOptions,
  context: { readonly directory?: string } = {},
  builds: WorkerBuildContext = createBuildContext(),
): Promise<WorkerBuildResult> =>
  builds.resolve({
    root: options.root,
    adapter: "renkin-astro-v1",
    ...buildIdentity(
      {
        output: options.output,
        compatibilityDate: options.compatibilityDate,
        compatibilityFlags: options.compatibilityFlags,
        assetRouting: options.assetRouting,
        configFile: options.configFile,
        config: options.config,
        session: options.session,
        sessionKVBindingName: options.sessionKVBindingName,
        prerenderEnvironment: options.prerenderEnvironment,
      },
      options.reuse,
    ),
    reuse:
      options.reuse === false
        ? false
        : {
            ...(options.config?.outDir
              ? {
                  outputRoot: dirname(resolve(options.root, options.config.outDir)),
                }
              : {}),
            ...options.reuse,
          },
    build: () => {
      const result = previousBuild.then(() => runBuild(options, context));
      previousBuild = result.catch(() => undefined);
      return result;
    },
  });
