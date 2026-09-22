import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { AstroConfig } from "astro";
import type { AstroBuildOptions } from "#src/contexts/root/models/astro-options.ts";

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

// The adapter nests pages beneath base; the deployed asset root is its parent.
export const assetDirectory = (config: AstroConfig): string =>
  resolve(
    fileURLToPath(config.build.client),
    ...config.base
      .split("/")
      .filter(Boolean)
      .map(() => ".."),
  );

export const buildResult = async (
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
