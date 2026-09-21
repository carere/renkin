import { relative } from "node:path";
import { emittedPath, portable, type SourcePackage } from "./layout.ts";

export const releaseManifest = (
  root: string,
  stage: string,
  packages: readonly SourcePackage[],
) => {
  const publicPackage = packages.find(({ manifest }) => manifest.name === "renkin");
  if (!publicPackage) throw new Error("Missing public Renkin package.");
  const { manifest, directory } = publicPackage;
  const dependencies: Record<string, string> = {};
  for (const entry of packages)
    for (const [name, range] of Object.entries(entry.manifest.dependencies ?? {})) {
      if (name.startsWith("@renkin/") || name === "effect") continue;
      if (dependencies[name] && dependencies[name] !== range)
        throw new Error(`Conflicting release dependency: ${name}`);
      dependencies[name] = range;
    }
  const target = (path: string) =>
    `./${portable(relative(stage, emittedPath(root, stage, `${directory}/${path}`)))}`;
  const exports = Object.fromEntries(
    Object.entries(manifest.exports).map(([key, path]) => {
      const js = target(path);
      return [key, { types: js.replace(/\.js$/, ".d.ts"), import: js, default: js }];
    }),
  );
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    license: "Apache-2.0",
    type: "module",
    engines: { bun: ">=1.4.2" },
    repository: { type: "git", url: "git+https://github.com/carere/renkin.git" },
    exports,
    types: exports["."]?.types,
    bin: Object.fromEntries(
      Object.entries(manifest.bin ?? {}).map(([key, path]) => [key, target(path)]),
    ),
    files: [
      "dist",
      "LICENSE",
      "NOTICE",
      "SOURCE_PROVENANCE.md",
      "THIRD_PARTY_NOTICES.md",
      "README.md",
    ],
    dependencies,
    peerDependencies: manifest.peerDependencies,
  };
};
