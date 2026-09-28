import { join, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import type { ReleaseError } from "./release-error.ts";
import { readdir, readFile } from "./release-files.ts";

interface SourceManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly imports?: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, string>>;
  readonly bin?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}
export interface SourcePackage {
  readonly directory: string;
  readonly manifest: SourceManifest;
}
const readManifest = (directory: string) =>
  readFile(join(directory, "package.json"), "utf8").pipe(
    Effect.map((source) => JSON.parse(source) as SourceManifest),
  );

/** Derive the private implementation closure from the public package's dependency graph. */
export const sourcePackages = (root: string) =>
  Effect.gen(function* () {
    const packages = new Map<string, SourcePackage>();
    const visit = (directory: string): Effect.Effect<void, ReleaseError> =>
      Effect.gen(function* () {
        const manifest = yield* readManifest(directory);
        if (packages.has(manifest.name)) return;
        packages.set(manifest.name, { directory, manifest });
        for (const name of Object.keys(manifest.dependencies ?? {}))
          if (name.startsWith("@renkin/")) yield* visit(join(root, "packages", name.slice(8)));
      });
    yield* visit(join(root, "packages/renkin"));
    return [...packages.values()];
  });
export const walkFiles = (directory: string): Effect.Effect<readonly string[], ReleaseError> =>
  Effect.gen(function* () {
    const entries = yield* readdir(directory);
    const files = yield* Effect.forEach(
      entries,
      (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(path) : Effect.succeed([path]);
      },
      { concurrency: "unbounded" },
    );
    return files.flat();
  });

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

/** Resolve project-local source aliases before private projects share one artifact namespace. */
export const sourceImportTarget = (owner: SourcePackage, specifier: string): string => {
  for (const [pattern, target] of Object.entries(owner.manifest.imports ?? {})) {
    const [prefix, suffix] = pattern.split("*");
    const capture =
      pattern === specifier
        ? ""
        : suffix !== undefined && specifier.startsWith(prefix ?? "") && specifier.endsWith(suffix)
          ? specifier.slice(prefix?.length ?? 0, suffix ? -suffix.length : undefined)
          : undefined;
    if (capture === undefined) continue;
    const resolved = resolve(owner.directory, target.replace("*", capture));
    const local = portable(relative(owner.directory, resolved));
    if (!target.startsWith("./src/") || !local.startsWith("src/"))
      throw new Error(`Release alias must reference production source: ${specifier}`);
    return resolved;
  }
  throw new Error(`Unknown release alias in ${owner.manifest.name}: ${specifier}`);
};
