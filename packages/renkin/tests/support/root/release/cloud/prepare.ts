import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { adaptCloudSource } from "./adapt.ts";
import { cloudSuites, consumerConfig, installedPaths, supportFiles } from "./catalog.ts";

const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
};
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const ignored =
  /^(?:node_modules|dist|\.git|\.renkin.*|\.astro|\.wrangler|\.tanstack|\.moon|\.env.*|\.dev\.vars.*)$/;

const copyTree = async (source: string, target: string) => {
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (ignored.test(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    if (entry.isSymbolicLink())
      throw new Error("Release cloud fixtures must not contain symlinks.");
    const path = join(source, entry.name),
      destination = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(path, destination);
    else if (entry.isFile()) await writeFile(destination, await readFile(path), { mode: 0o600 });
  }
};

const installedConsumer = async (root: string, directory: string) => {
  const consumer = await realpath(directory),
    checkout = await realpath(root);
  if (consumer === checkout || inside(checkout, consumer))
    throw new Error("Installed cloud consumer must be outside the source checkout.");
  const packageRoot = await realpath(join(consumer, "node_modules/renkin"));
  if (!inside(consumer, packageRoot))
    throw new Error("Installed Renkin resolves outside consumer.");
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (pkg.name !== "renkin" || !pkg.bin || JSON.stringify(pkg).includes("workspace:"))
    throw new Error("Cloud consumer requires the standalone installed Renkin artifact.");
  for (const app of ["example-spa", "example-ssr", "example-static", "website"])
    if (!inside(consumer, await realpath(join(consumer, "apps", app))))
      throw new Error("Installed framework root escapes consumer.");
  return consumer;
};

/** Copies only maintained test/fixture source; never environment files, secrets or built artifacts. */
export const prepareInstalledCloud = async (
  root: string,
  consumerDirectory: string,
): Promise<void> => {
  const consumer = await installedConsumer(root, consumerDirectory);
  const source = join(root, "packages/renkin"),
    target = join(consumer, "packages/renkin");
  const observed = (await readdir(join(source, "tests/cloud/root")))
    .filter((file) => file.endsWith(".test.ts"))
    .sort();
  if (
    JSON.stringify(observed) !== JSON.stringify(cloudSuites.map((name) => `${name}.test.ts`).sort())
  )
    throw new Error("Maintained cloud suite inventory changed; update installed mapping.");
  const files = [
    ...cloudSuites.map((name) => `tests/cloud/root/${name}.test.ts`),
    ...supportFiles.map((name) => `tests/support/root/${name}`),
  ];
  const inventory = [];
  for (const path of files) {
    if (!(await lstat(join(source, path))).isFile())
      throw new Error("Expected regular maintained cloud source.");
    const input = await readFile(join(source, path), "utf8"),
      output = adaptCloudSource(path, input);
    await mkdir(dirname(join(target, path)), { recursive: true, mode: 0o700 });
    await writeFile(join(target, path), output, { mode: 0o600 });
    inventory.push({ path, sourceHash: digest(input), installedHash: digest(output) });
  }
  await copyTree(
    join(source, "tests/fixtures/full-graph"),
    join(target, "tests/fixtures/full-graph"),
  );
  await copyTree(
    join(source, "tests/fixtures/durable-object"),
    join(target, "tests/fixtures/durable-object"),
  );
  await writeFile(join(target, "tests/support/root/installed-cloud-paths.ts"), installedPaths, {
    mode: 0o600,
  });
  await writeFile(join(target, "vitest.installed-cloud.config.ts"), consumerConfig, {
    mode: 0o600,
  });
  await writeFile(
    join(consumer, "release-cloud-manifest.json"),
    JSON.stringify(
      {
        version: 1,
        suites: cloudSuites,
        inventory,
        bootstrap:
          "protected-site creates and removes an isolated coordinator through installed public deploy",
        excludedAdapterSuites: [
          "packages/cloudflare/tests/cloud/root/services/state/state-authorization.test.ts",
        ],
        note: "Public suite preparation is not provider execution or proof of private adapter authorization invariants.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
};
