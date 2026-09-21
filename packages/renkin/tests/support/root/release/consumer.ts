import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export const execute = promisify(execFile);
const consumerEnvironment = (directory: string) => ({
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  HOME: process.env.HOME ?? "",
  TMPDIR: tmpdir(),
  XDG_CONFIG_HOME: join(directory, ".config"),
  CLOUDFLARE_AUTH_USE_KEYRING: "false",
  RENKIN_TEST_POLLING: "true",
  RENKIN_GRAPH_POLLING: "true",
  NO_COLOR: "1",
});
const copy = (source: string, destination: string) =>
  cp(source, destination, {
    recursive: true,
    filter: (path) =>
      !/(?:\/(?:node_modules|dist|\.renkin[^/]*|\.astro|\.wrangler|\.tanstack|\.moon|\.env[^/]*|\.dev\.vars[^/]*)(?:\/|$)|\.tsbuildinfo$)/.test(
        path,
      ),
  });
const applications = ["example-spa", "example-ssr", "example-static", "website"];
const appDependencies = async (root: string) => {
  const dependencies: Record<string, string> = {};
  for (const name of applications) {
    const manifest = JSON.parse(await readFile(join(root, "apps", name, "package.json"), "utf8"));
    Object.assign(dependencies, manifest.dependencies, manifest.devDependencies);
  }
  const owner = JSON.parse(await readFile(join(root, "packages/renkin/package.json"), "utf8"));
  Object.assign(dependencies, owner.devDependencies);
  delete dependencies.renkin;
  delete dependencies["@babel/parser"];
  delete dependencies.esbuild;
  return dependencies;
};
const copyApplications = async (root: string, directory: string) => {
  for (const name of applications) {
    const destination = join(directory, "apps", name);
    await copy(join(root, "apps", name), destination);
    const config = JSON.parse(await readFile(join(destination, "tsconfig.json"), "utf8"));
    delete config.references;
    delete config.compilerOptions.outDir;
    await writeFile(join(destination, "tsconfig.json"), JSON.stringify(config, null, 2));
    const manifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
    manifest.dependencies.renkin = JSON.parse(
      await readFile(join(directory, "node_modules/renkin/package.json"), "utf8"),
    ).version;
    await writeFile(join(destination, "package.json"), JSON.stringify(manifest, null, 2));
  }
};

export const installConsumer = async (root: string, archive: string) => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-installed-release-"));
  try {
    const dependencies = await appDependencies(root);
    const tools = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify(
        {
          private: true,
          type: "module",
          dependencies: {
            ...dependencies,
            renkin: `file:${archive}`,
            effect: tools.devDependencies.effect,
          },
          devDependencies: {
            typescript: tools.devDependencies.typescript,
            "@moonrepo/cli": tools.devDependencies["@moonrepo/cli"],
            "@types/node": tools.devDependencies["@types/node"],
          },
        },
        null,
        2,
      ),
    );
    await mkdir(join(directory, ".config"));
    await execute(process.execPath, ["install"], {
      cwd: directory,
      env: consumerEnvironment(directory),
      timeout: 180000,
      maxBuffer: 200000,
    });
    await copyApplications(root, directory);
    const compiler = JSON.parse(await readFile(join(root, "tsconfig.options.json"), "utf8"));
    Object.assign(compiler.compilerOptions, {
      composite: false,
      declaration: false,
      declarationMap: false,
      emitDeclarationOnly: false,
      noEmit: true,
    });
    await writeFile(join(directory, "tsconfig.options.json"), JSON.stringify(compiler, null, 2));
    await copy(
      join(root, "packages/renkin/tests/fixtures/full-graph"),
      join(directory, "tests/fixtures/full-graph"),
    );
    await writeFile(
      join(directory, "tests/fixtures/full-graph/package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await copy(
      join(root, "packages/renkin/tests/support/root/full-graph"),
      join(directory, "tests/support/root/full-graph"),
    );
    await copy(
      join(root, "packages/renkin/tests/unit/root/worker-types.test.ts"),
      join(directory, "worker-types.test.ts"),
    );
    return {
      directory,
      env: consumerEnvironment(directory),
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
export type InstalledConsumer = Awaited<ReturnType<typeof installConsumer>>;
