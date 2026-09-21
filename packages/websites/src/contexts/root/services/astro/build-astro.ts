import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import { type AstroConfig, build } from "astro";
import type { AstroBuildOptions } from "../../models/astro-options.ts";

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
  const root = resolve(options.root);
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

/** Runs the official adapter. High-level resource bindings are attached only after page generation. */
export const buildAstro = async (
  options: AstroBuildOptions,
  context: { readonly directory?: string } = {},
): Promise<WorkerBuildResult> => {
  const { root, directory, configPath } = await prepareConfiguration(options, context);
  let resolvedConfig: AstroConfig | undefined;
  let clientDirectory: string | undefined;
  await build({
    ...options.config,
    root,
    ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
    output: options.output,
    ...(options.output === "static" || options.sessionKVBindingName === false
      ? { session: false }
      : options.session
        ? { session: options.session }
        : {}),
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
            clientDirectory = fileURLToPath(config.build.client);
          },
        },
      },
    ],
  });
  if (!resolvedConfig) throw new Error("Astro did not produce a resolved build configuration.");
  const config: AstroConfig = resolvedConfig;
  const compatibility = {
    compatibilityDate: options.compatibilityDate,
    compatibilityFlags: options.compatibilityFlags ?? ["nodejs_compat"],
  };
  if (options.output === "static") {
    const entry = resolve(directory, "static-worker.mjs");
    await writeFile(
      entry,
      "export default {fetch(request, env) {return env.ASSETS.fetch(request)}};\n",
    );
    return {
      entry,
      ...compatibility,
      assets: {
        directory: clientDirectory ?? fileURLToPath(config.build.client),
        config: { notFoundHandling: "404-page" },
      },
    };
  }
  const entry = fileURLToPath(new URL(config.build.serverEntry, config.build.server));
  return {
    entry,
    modules: await modulesIn(dirname(entry), entry),
    ...compatibility,
    assets: {
      directory: clientDirectory ?? fileURLToPath(config.build.client),
      config: { notFoundHandling: "none" },
    },
  };
};
