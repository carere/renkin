import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { TanStackOptions } from "../../models/tanstack.ts";

const buildEnvironment = (options: TanStackOptions, directory: string): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "SYSTEMROOT", "TEMP", "USERPROFILE"])
    if (process.env[key]) environment[key] = process.env[key];
  return {
    ...environment,
    ...options.buildEnvironment,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: resolve(directory, "wrangler.log"),
    WRANGLER_REGISTRY_PATH: resolve(directory, "registry"),
    MINIFLARE_REGISTRY_PATH: resolve(directory, "miniflare"),
  };
};

const runBuild = (options: TanStackOptions, directory: string, manifest: string) =>
  new Promise<void>((resolveBuild, reject) => {
    const child = spawn(
      process.versions.bun ? process.execPath : "bun",
      [
        "--no-env-file",
        fileURLToPath(new URL("./build-entry.ts", import.meta.url)),
        JSON.stringify({
          root: options.root,
          configFile: options.configFile,
          rendering: options.rendering,
          manifest,
        }),
      ],
      {
        cwd: options.root,
        env: buildEnvironment(options, directory),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let diagnostic = "";
    const capture = (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-12_000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolveBuild() : reject(new Error(`TanStack build failed.\n${diagnostic}`)),
    );
  });

export const buildTanStack = async (options: TanStackOptions): Promise<WorkerBuildResult> => {
  await options.beforeBuild?.();
  const directory = await mkdtemp(resolve(tmpdir(), "renkin-tanstack-build-"));
  try {
    const manifest = resolve(directory, "build.json");
    await runBuild(options, directory, manifest);
    const artifact = JSON.parse(await readFile(manifest, "utf8")) as WorkerBuildResult;
    const result: WorkerBuildResult = {
      ...artifact,
      compatibilityDate: options.compatibilityDate,
      compatibilityFlags: options.compatibilityFlags ?? ["nodejs_compat"],
      ...(artifact.assets
        ? {
            assets: {
              ...artifact.assets,
              config:
                options.assets ??
                (options.rendering === "spa"
                  ? {
                      notFoundHandling: "single-page-application",
                      runWorkerFirst: ["/_serverFn/*", "/api/*"],
                    }
                  : { notFoundHandling: "none" }),
            },
          }
        : {}),
    };
    await options.afterBuild?.(result);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
