import { type BuildOptions, type BuildResult, build } from "esbuild";

export interface WorkerBundle {
  readonly code: string;
  readonly inputs: readonly string[];
}

export const bundleOptions = (entry: string): BuildOptions => ({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["module", "main"],
  external: ["cloudflare:*", "node:*"],
  metafile: true,
  logLevel: "silent",
  sourcemap: "inline",
});

export const readBundle = (result: BuildResult): WorkerBundle => {
  const code = result.outputFiles?.[0]?.text;
  if (!code) throw new Error("Worker build produced no JavaScript.");
  return { code, inputs: Object.keys(result.metafile?.inputs ?? {}) };
};

export const bundleWorker = async (
  entry: string,
  options: { readonly sourceMap?: boolean } = {},
): Promise<WorkerBundle> =>
  readBundle(
    await build({
      ...bundleOptions(entry),
      sourcemap: options.sourceMap === false ? false : "inline",
    }),
  );
