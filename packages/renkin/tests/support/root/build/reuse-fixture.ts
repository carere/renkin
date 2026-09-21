import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAstro } from "renkin/astro";
import { astro, kv, tanstackStart } from "renkin/cloudflare";
import { buildTanStack } from "renkin/vite";

export type Mode = "solid-spa" | "solid-ssr" | "astro-static" | "astro-ssr";
interface FixtureBase {
  readonly root: string;
  readonly compatibilityDate: string;
  readonly reuse: {
    readonly key: string;
    readonly inputs: readonly string[];
    readonly values: { readonly hook: string };
  };
}

const linkDependencies = async (source: string, root: string) => {
  const directory = resolve(root, "node_modules");
  await mkdir(directory);
  for (const name of await readdir(source)) {
    if (name.startsWith(".")) continue;
    await symlink(resolve(source, name), resolve(directory, name), "dir");
  }
};

const solid = async (mode: Mode, base: FixtureBase, compiled: () => void) => {
  const root = base.root;
  const rendering = mode === "solid-spa" ? "spa" : "ssr";
  const source = fileURLToPath(
    new URL(`../../../../../../apps/example-${rendering}/`, import.meta.url),
  );
  await cp(resolve(source, "src"), resolve(root, "src"), { recursive: true });
  await cp(resolve(source, "package.json"), resolve(root, "package.json"));
  await linkDependencies(resolve(source, "node_modules"), root);
  const configuration = resolve(root, "vite.config.ts");
  await writeFile(
    configuration,
    `import {renkin} from 'renkin/vite';\nimport {tanstackStart} from 'renkin/cloudflare';\nexport default {plugins:[renkin(tanstackStart('compiler',{root:import.meta.dirname,rendering:${JSON.stringify(rendering)},compatibilityDate:'2026-07-30',sourceMap:true}))]};\n`,
  );
  const site = (id: string, stage = "preview") =>
    tanstackStart(id, {
      ...base,
      rendering,
      sourceMap: true,
      beforeBuild: compiled,
      buildEnvironment: { VITE_APPLICATION: stage, PROTO_OFFLINE: "true" },
      bindings: { DATA: kv(`${id}-data`) },
    });
  return {
    configuration,
    site,
    build: (id: string, stage?: string) => buildTanStack(site(id, stage)),
  };
};

const astroSite = async (mode: Mode, base: FixtureBase, compiled: () => void) => {
  const root = base.root;
  await mkdir(resolve(root, "src/pages"), { recursive: true });
  await writeFile(
    resolve(root, "src/pages/index.astro"),
    `---\nconst stage=import.meta.env.PUBLIC_STAGE;\n---\n<html><body><h1>{stage}</h1></body></html>`,
  );
  const configuration = resolve(root, "astro.config.mjs");
  await writeFile(configuration, "export default {};\n");
  const modules = fileURLToPath(
    new URL("../../../../../../packages/websites/node_modules/", import.meta.url),
  );
  await linkDependencies(modules, root);
  const site = (id: string, stage = "preview") =>
    astro(id, {
      ...base,
      output: mode === "astro-static" ? "static" : "server",
      sessionKVBindingName: false,
      bindings: { DATA: kv(`${id}-data`) },
      config: {
        logLevel: "silent",
        integrations: [{ name: "compile-counter", hooks: { "astro:build:start": compiled } }],
        vite: {
          build: { sourcemap: true },
          define: { "import.meta.env.PUBLIC_STAGE": JSON.stringify(stage) },
        },
      },
    });
  return {
    configuration,
    site,
    build: (id: string, stage?: string) => buildAstro(site(id, stage)),
  };
};

export const reuseFixture = async (mode: Mode) => {
  const directory = await mkdtemp(resolve(tmpdir(), `renkin-${mode}-reuse-`));
  const root = resolve(directory, "app");
  const shared = resolve(directory, "shared.txt");
  await mkdir(resolve(root, "public"), { recursive: true });
  await writeFile(shared, "first shared input");
  await writeFile(resolve(directory, "bun.lock"), "fixture lock\n");
  await writeFile(resolve(root, "public/deployment.json"), '{"version":1}');
  await writeFile(resolve(root, "public/_headers"), "/*\n  X-Reuse: first\n");
  await writeFile(resolve(root, ".gitignore"), "public/deployment.json\n");
  let compilations = 0;
  const compiled = () => {
    compilations++;
  };
  const reuse = { key: "fixture-compiler-v1", inputs: [shared], values: { hook: "count-only" } };
  const base = { root, compatibilityDate: "2026-07-30", reuse };
  const framework = await (mode.startsWith("solid") ? solid : astroSite)(mode, base, compiled);
  return {
    directory,
    root,
    shared,
    ...framework,
    compilations: () => compilations,
    close: () => rm(directory, { recursive: true, force: true }),
  };
};

export const appendInput = async (path: string) =>
  writeFile(path, `${await readFile(path, "utf8")}\n`);
