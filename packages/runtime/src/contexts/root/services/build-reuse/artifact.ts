import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { WorkerBuildResult } from "../../models/build-result.ts";
import { readBuildResult } from "../bundler/read-build-result.ts";
import { canonicalBuildValue, digest } from "./fingerprint.ts";

const optionalFile = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

const contained = async (root: string, path: string) => {
  const actual = await realpath(path);
  const name = relative(root, actual);
  if (name === ".." || name.startsWith("../") || isAbsolute(name))
    throw new Error("Build outputs must remain within their declared outputRoot.");
};

/** The inventory covers all effective assets, listed modules and routing controls. */
export const captureArtifact = async (build: WorkerBuildResult, outputRoot?: string) => {
  if (outputRoot) {
    await contained(outputRoot, build.entry);
    if (build.assets) await contained(outputRoot, build.assets.directory);
  }
  const bytes = await readBuildResult(build);
  const auxiliary = await Promise.all(
    (build.auxiliaryFiles ?? []).map(async (path) => {
      if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
        throw new Error("Auxiliary files must stay within the entry directory.");
      await contained(await realpath(dirname(build.entry)), resolve(dirname(build.entry), path));
      return {
        path,
        content: (await readFile(resolve(dirname(build.entry), path))).toString("base64"),
      };
    }),
  );
  const assetIgnore = build.assets
    ? await optionalFile(resolve(build.assets.directory, ".assetsignore"))
    : null;
  const metadata = {
    modules: build.modules ?? [],
    compatibilityDate: build.compatibilityDate ?? null,
    compatibilityFlags: build.compatibilityFlags ?? [],
    assets: build.assets
      ? { binding: build.assets.binding ?? "ASSETS", config: build.assets.config ?? {} }
      : null,
  };
  return {
    bytes,
    auxiliary,
    assetIgnore,
    hash: digest(canonicalBuildValue({ bytes, auxiliary, assetIgnore, metadata })),
  };
};

type Artifact = Awaited<ReturnType<typeof captureArtifact>>;

const write = async (root: string, path: string, value: string | Uint8Array) => {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, value, { mode: 0o600 });
};

const writeArtifact = async (directory: string, artifact: Artifact) => {
  const { bytes } = artifact;
  await write(directory, `worker/${bytes.mainModule}`, bytes.source);
  for (const module of bytes.modules)
    await write(directory, `worker/${module.name}`, Buffer.from(module.content, "base64"));
  for (const file of artifact.auxiliary)
    await write(directory, `worker/${file.path}`, Buffer.from(file.content, "base64"));
  if (!bytes.assets) return;
  await mkdir(resolve(directory, "assets"), { recursive: true, mode: 0o700 });
  for (const [name, asset] of Object.entries(bytes.assets.files))
    await write(directory, `assets${name}`, Buffer.from(asset.content, "base64"));
  if (artifact.assetIgnore !== null)
    await write(directory, "assets/.assetsignore", artifact.assetIgnore);
  if (bytes.assets.config.headers !== undefined)
    await write(directory, "assets/_headers", bytes.assets.config.headers);
  if (bytes.assets.config.redirects !== undefined)
    await write(directory, "assets/_redirects", bytes.assets.config.redirects);
};

const relocated = (build: WorkerBuildResult, directory: string): WorkerBuildResult => ({
  entry: resolve(directory, "worker", basename(build.entry)),
  ...(build.modules ? { modules: build.modules } : {}),
  ...(build.auxiliaryFiles ? { auxiliaryFiles: build.auxiliaryFiles } : {}),
  ...(build.assets ? { assets: { ...build.assets, directory: resolve(directory, "assets") } } : {}),
  ...(build.compatibilityDate ? { compatibilityDate: build.compatibilityDate } : {}),
  ...(build.compatibilityFlags ? { compatibilityFlags: build.compatibilityFlags } : {}),
});

/** Publish a complete immutable capture; consumers never see the temporary directory. */
export const saveArtifact = async (
  root: string,
  input: string,
  build: WorkerBuildResult,
  artifact: Artifact,
) => {
  let directory = resolve(root, ".renkin/build/artifacts", input, artifact.hash);
  let result = relocated(build, directory);
  try {
    if ((await captureArtifact(result)).hash === artifact.hash) return result;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  // Never replace a previously published directory while another consumer may be reading it.
  directory = `${directory}-${randomUUID()}`;
  result = relocated(build, directory);
  const temporary = `${directory}.tmp`;
  try {
    await writeArtifact(temporary, artifact);
    await rename(temporary, directory);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return result;
};
