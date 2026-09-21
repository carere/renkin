import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { BuildCommandOptions } from "../../models/build-command.ts";
import type { WorkerBuildResult } from "../../models/build-result.ts";
import type { WorkerBuildRecipe } from "../../models/worker-builder.ts";
import { createBuildContext } from "../build-reuse/build-context.ts";

const execute = (options: BuildCommandOptions, lease: Readonly<Record<string, string>>) =>
  new Promise<void>((done, reject) => {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "SYSTEMROOT", "TEMP", "USERPROFILE"])
      if (process.env[key]) environment[key] = process.env[key];
    const child = spawn(options.command[0], options.command.slice(1), {
      cwd: options.cwd,
      env: { ...environment, ...options.environment, ...lease },
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? done() : reject(new Error(`Build command exited with status ${code}.`)),
    );
  });

/** A command publishes a manifest only after all its outputs are complete. */
export const buildCommand = (options: BuildCommandOptions): WorkerBuildRecipe => ({
  build: (context = createBuildContext()) =>
    context.resolve({
      root: resolve(options.cwd, options.root ?? "."),
      adapter: "renkin-build-command-v1",
      values: {
        command: options.command,
        cwd: resolve(options.cwd),
        manifest: options.manifest,
        environment: options.environment ?? {},
        values: options.values ?? null,
      },
      ...(options.reuse === undefined ? {} : { reuse: options.reuse }),
      async build({ environment }) {
        const manifest = resolve(options.cwd, options.manifest);
        await rm(manifest, { force: true });
        await execute(options, environment);
        const result = JSON.parse(await readFile(manifest, "utf8")) as WorkerBuildResult;
        if (!result || typeof result.entry !== "string")
          throw new Error("Build command did not emit a WorkerBuildResult.");
        return {
          ...result,
          entry: resolve(options.cwd, result.entry),
          ...(result.assets
            ? {
                assets: {
                  ...result.assets,
                  directory: resolve(options.cwd, result.assets.directory),
                },
              }
            : {}),
        };
      },
    }),
});
