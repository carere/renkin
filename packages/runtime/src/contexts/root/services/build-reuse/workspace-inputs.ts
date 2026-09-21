import { glob, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface Manifest {
  readonly name?: string;
  readonly workspaces?: readonly string[] | { readonly packages: readonly string[] };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const manifestAt = async (root: string): Promise<Manifest | undefined> => {
  try {
    return JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as Manifest;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
};

const workspace = async (root: string) => {
  for (let directory = root; ; directory = dirname(directory)) {
    const manifest = await manifestAt(directory);
    if (manifest?.workspaces) return { directory, workspaces: manifest.workspaces };
    if (dirname(directory) === directory) return;
  }
};

/** Source workspaces are inputs even when the package manager links them through node_modules. */
export const workspaceInputs = async (root: string): Promise<readonly string[]> => {
  const owner = await workspace(root);
  const app = await manifestAt(root);
  if (!owner || !app) return [];
  const patterns = "packages" in owner.workspaces ? owner.workspaces.packages : owner.workspaces;
  const packages = new Map<string, { directory: string; manifest: Manifest }>();
  for await (const path of glob(
    patterns.map((pattern) => `${pattern}/package.json`),
    { cwd: owner.directory },
  )) {
    const directory = dirname(resolve(owner.directory, path));
    const manifest = await manifestAt(directory);
    if (manifest?.name) packages.set(manifest.name, { directory, manifest });
  }
  const directories = new Set<string>();
  const visit = (manifest: Manifest) => {
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    for (const [name, version] of Object.entries(dependencies)) {
      if (!version.startsWith("workspace:")) continue;
      const dependency = packages.get(name);
      if (!dependency) throw new Error(`Workspace build input ${name} is missing.`);
      if (directories.has(dependency.directory)) continue;
      directories.add(dependency.directory);
      visit(dependency.manifest);
    }
  };
  visit(app);
  return [...directories].sort();
};
