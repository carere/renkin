import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkerBuildResult } from "../../models/build-result.ts";

export interface PreparedAsset {
  readonly hash: string;
  readonly size: number;
  readonly content: string;
}

const readModules = async (build: WorkerBuildResult, entry: string) => {
  const modules = await Promise.all(
    (build.modules ?? []).map(async (module) => {
      if (isAbsolute(module.path) || module.path.split(/[\\/]/).includes(".."))
        throw new Error("Build module paths must remain inside the entry directory.");
      const path = await realpath(resolve(dirname(entry), module.path));
      if (relative(dirname(entry), path).startsWith(`..${sep}`))
        throw new Error("Build module symlinks must remain inside the entry directory.");
      return {
        name: module.path.replaceAll("\\", "/"),
        type: module.type,
        content: (await readFile(path)).toString("base64"),
      };
    }),
  );
  if (
    modules.some((module) => module.name === basename(entry)) ||
    new Set(modules.map((module) => module.name)).size !== modules.length
  )
    throw new Error("Build modules must have unique names distinct from the entry.");
  return modules;
};

/** Capture bytes before planning, so an external rebuild cannot alter an in-flight upload. */
export const readBuildResult = async (build: WorkerBuildResult) => {
  const entry = await realpath(build.entry);
  const source = await readFile(entry, "utf8");
  const modules = await readModules(build, entry);
  const assets: Record<string, PreparedAsset> = {};
  let headers: string | undefined;
  let redirects: string | undefined;
  if (build.assets) {
    const root = await realpath(build.assets.directory);
    const walk = async (directory: string): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        const path = resolve(directory, name);
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) throw new Error("Asset symlinks are not supported.");
        if (stat.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!stat.isFile()) throw new Error("Assets must be regular files.");
        const key = `/${relative(root, path).split(sep).join("/")}`;
        const bytes = await readFile(path);
        if (key === "/_headers") {
          headers = bytes.toString("utf8");
          continue;
        }
        if (key === "/_redirects") {
          redirects = bytes.toString("utf8");
          continue;
        }
        if (bytes.byteLength > 25 * 1024 * 1024)
          throw new Error("An asset exceeds Cloudflare's 25 MiB limit.");
        // Cloudflare addresses assets using a 32-character content hash including the extension.
        const hash = createHash("sha256")
          .update(bytes)
          .update(extname(path))
          .digest("hex")
          .slice(0, 32);
        assets[key] = { hash, size: bytes.byteLength, content: bytes.toString("base64") };
      }
    };
    await walk(root);
  }
  return {
    source,
    mainModule: basename(entry),
    modules,
    ...(build.assets
      ? {
          assets: {
            files: assets,
            binding: build.assets.binding ?? "ASSETS",
            config: {
              ...build.assets.config,
              ...(headers === undefined ? {} : { headers }),
              ...(redirects === undefined ? {} : { redirects }),
            },
          },
        }
      : {}),
  };
};
