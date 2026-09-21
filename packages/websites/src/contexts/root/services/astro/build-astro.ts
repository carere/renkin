import { createHash } from "node:crypto";
import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { WorkerBuildContext } from "@renkin/runtime/models/build-reuse";
import { createBuildContext } from "@renkin/runtime/services/build-reuse/build-context";
import { type AstroConfig, type AstroInlineConfig, build } from "astro";
import { sessionDrivers } from "astro/config";
import type { AstroBuildOptions } from "../../models/astro-options.ts";
import { buildIdentity } from "../build/reuse-options.ts";
import { adapterResolution } from "./adapter-resolution.ts";

const moduleTypes: Readonly<Record<string, string>> = {
  ".js": "application/javascript+module",
  ".mjs": "application/javascript+module",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};

const modulesIn = async (directory: string, entry: string) => {
  const modules: { path: string; type: string }[] = [];
  const walk = async (path: string): Promise<void> => {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, item.name);
      if (item.isSymbolicLink()) throw new Error("Astro build modules cannot be symbolic links.");
      if (item.isDirectory()) await walk(full);
      else if (full !== entry) {
        const type = moduleTypes[extname(full)];
        if (type) modules.push({ path: relative(directory, full).replaceAll("\\", "/"), type });
      }
    }
  };
  await walk(directory);
  return modules.sort((left, right) => left.path.localeCompare(right.path));
};

const prepareConfiguration = async (
  options: AstroBuildOptions,
  context: { readonly directory?: string },
) => {
  const root = await realpath(resolve(options.root));
  const identity = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const directory = resolve(context.directory ?? resolve(root, ".renkin"), "astro", identity);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configPath = resolve(directory, "worker.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: `renkin-astro-${identity}`,
      compatibility_date: options.compatibilityDate,
      compatibility_flags: options.compatibilityFlags ?? ["nodejs_compat"],
    }),
    { mode: 0o600 },
  );
  return { root, directory, configPath };
};

// The adapter nests pages beneath base; the deployed asset root is its parent.
const assetDirectory = (config: AstroConfig): string =>
  resolve(
    fileURLToPath(config.build.client),
    ...config.base
      .split("/")
      .filter(Boolean)
      .map(() => ".."),
  );

const buildResult = async (
  options: AstroBuildOptions,
  config: AstroConfig,
  clientDirectory: string | undefined,
): Promise<WorkerBuildResult> => {
  const compatibility = {
    compatibilityDate: options.compatibilityDate,
    compatibilityFlags: options.compatibilityFlags ?? ["nodejs_compat"],
  };
  if (options.output === "static") {
    const entry = resolve(fileURLToPath(config.outDir), "server", "static-worker.mjs");
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(
      entry,
      "export default {fetch(request, env) {return env.ASSETS.fetch(request)}};\n",
    );
    return {
      entry,
      ...compatibility,
      assets: {
        directory: clientDirectory ?? fileURLToPath(config.build.client),
        config: { notFoundHandling: "404-page", ...options.assetRouting },
      },
    };
  }
  const entry = fileURLToPath(new URL(config.build.serverEntry, config.build.server));
  return {
    entry,
    modules: await modulesIn(dirname(entry), entry),
    auxiliaryFiles: (await readdir(dirname(entry), { recursive: true })).filter((path) =>
      path.endsWith(".map"),
    ),
    ...compatibility,
    assets: {
      directory: clientDirectory ?? fileURLToPath(config.build.client),
      config: { notFoundHandling: "none", ...options.assetRouting },
    },
  };
};

/** Runs the official adapter. High-level resource bindings are attached only after page generation. */
const runBuild = async (
  options: AstroBuildOptions,
  context: { readonly directory?: string } = {},
): Promise<WorkerBuildResult> => {
  const { root, configPath } = await prepareConfiguration(options, context);
  let resolvedConfig: AstroConfig | undefined;
  let clientDirectory: string | undefined;
  await build({
    logLevel: "silent",
    ...options.config,
    root,
    vite: {
      logLevel: "silent",
      ...options.config?.vite,
      plugins: [adapterResolution(), ...(options.config?.vite?.plugins ?? [])],
    },
    ...(options.configFile === undefined
      ? {}
      : {
          configFile:
            options.configFile === false
              ? false
              : relative(root, resolve(root, options.configFile)),
        }),
    output: options.output,
    // The resource boundary owns the driver, even if a loaded config sets another one.
    session: (options.output === "static" || options.sessionKVBindingName === false
      ? false
      : {
          ...options.session,
          driver: sessionDrivers.cloudflareKVBinding({
            binding: options.sessionKVBindingName ?? "SESSION",
          }),
        }) as NonNullable<AstroInlineConfig["session"]>,
    adapter: cloudflare({
      configPath,
      remoteBindings: false,
      inspectorPort: false,
      persistState: false,
      imageService: "passthrough",
      sessionKVBindingName: options.sessionKVBindingName || "SESSION",
      prerenderEnvironment: options.prerenderEnvironment ?? "workerd",
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
  const config: AstroConfig = resolvedConfig;
  return buildResult(options, config, clientDirectory);
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
