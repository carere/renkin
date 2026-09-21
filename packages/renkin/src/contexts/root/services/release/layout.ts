import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

interface SourceManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly exports: Readonly<Record<string, string>>;
  readonly bin?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}
export interface SourcePackage {
  readonly directory: string;
  readonly manifest: SourceManifest;
}
const readManifest = async (directory: string): Promise<SourceManifest> =>
  JSON.parse(await readFile(join(directory, "package.json"), "utf8"));

/** Derive the private implementation closure from the public package's dependency graph. */
export const sourcePackages = async (root: string): Promise<readonly SourcePackage[]> => {
  const packages = new Map<string, SourcePackage>();
  const visit = async (directory: string) => {
    const manifest = await readManifest(directory);
    if (packages.has(manifest.name)) return;
    packages.set(manifest.name, { directory, manifest });
    for (const name of Object.keys(manifest.dependencies ?? {}))
      if (name.startsWith("@renkin/")) await visit(join(root, "packages", name.slice(8)));
  };
  await visit(join(root, "packages/renkin"));
  return [...packages.values()];
};
export const walkFiles = async (directory: string): Promise<readonly string[]> =>
  (
    await Promise.all(
      (
        await readdir(directory, { withFileTypes: true })
      ).map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(path) : [path];
      }),
    )
  ).flat();

export const portable = (path: string) => path.split(sep).join("/");
export const emittedName = (path: string) => path.replace(/\.(?:ts|tsx)$/, ".js");
export const emittedPath = (root: string, stage: string, source: string) =>
  resolve(stage, "dist", emittedName(relative(join(root, "packages"), source)));
export const sourceTarget = (packages: readonly SourcePackage[], specifier: string): string => {
  const owner = packages.find(({ manifest }) => specifier.startsWith(`${manifest.name}/`));
  if (!owner) throw new Error(`Unknown private release import: ${specifier}`);
  const key = `.${specifier.slice(owner.manifest.name.length)}`;
  for (const [pattern, target] of Object.entries(owner.manifest.exports)) {
    if (pattern === key) return resolve(owner.directory, target);
    const [prefix, suffix] = pattern.split("*");
    if (suffix !== undefined && key.startsWith(prefix ?? "") && key.endsWith(suffix)) {
      const capture = key.slice(prefix?.length ?? 0, suffix ? -suffix.length : undefined);
      return resolve(owner.directory, target.replace("*", capture));
    }
  }
  throw new Error(`Private release import is not exported: ${specifier}`);
};
