import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { transform } from "esbuild";
import { buildInfo } from "./build-info.ts";
import { emitDeclarations } from "./declarations.ts";
import {
  emittedName,
  emittedPath,
  portable,
  type SourcePackage,
  sourceImportTarget,
  sourcePackages,
  sourceTarget,
  walkFiles,
} from "./layout.ts";
import { releaseManifest } from "./manifest.ts";
import { rewriteSpecifiers } from "./module-specifiers.ts";

const write = async (path: string, source: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
};
export const assembleRelease = async (root: string, stage: string) => {
  const packages = await sourcePackages(root);
  const temporary = await mkdtemp(join(tmpdir(), "renkin-declarations-"));
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const rewrite = (source: string, file: string, owner: SourcePackage) =>
    rewriteSpecifiers(source, (specifier) => {
      if (!specifier.startsWith("@renkin/") && !specifier.startsWith("#"))
        return specifier.startsWith(".") ? emittedName(specifier) : specifier;
      const target = emittedPath(
        root,
        stage,
        specifier.startsWith("#")
          ? sourceImportTarget(owner, specifier)
          : sourceTarget(packages, specifier),
      );
      const path = portable(relative(dirname(file), target));
      return path.startsWith(".") ? path : `./${path}`;
    });
  try {
    for (const owner of packages)
      for (const source of await walkFiles(join(owner.directory, "src"))) {
        if (
          !source.endsWith(".ts") ||
          source.endsWith(".d.ts") ||
          source.includes("/services/release/")
        )
          continue;
        const destination = emittedPath(root, stage, source);
        const { code } = await transform(await readFile(source, "utf8"), {
          loader: "ts",
          format: "esm",
          target: "es2022",
          legalComments: "inline",
        });
        await write(destination, rewrite(code, destination, owner));
      }
    const types = await emitDeclarations(root, temporary, packages);
    for (const source of await walkFiles(types)) {
      if (!source.endsWith(".d.ts")) continue;
      const destination = join(stage, "dist", relative(types, source));
      const owner = packages.find(({ directory }) =>
        relative(types, source).startsWith(`${relative(join(root, "packages"), directory)}/`),
      );
      if (!owner) throw new Error(`Unknown declaration owner: ${source}`);
      await write(destination, rewrite(await readFile(source, "utf8"), destination, owner));
    }
    await write(
      join(stage, "BUILD_INFO.json"),
      `${JSON.stringify(await buildInfo(root), null, 2)}\n`,
    );
    const manifest = releaseManifest(root, stage, packages);
    await write(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const name of ["LICENSE", "NOTICE", "SOURCE_PROVENANCE.md", "THIRD_PARTY_NOTICES.md"])
      await copyFile(join(root, name), join(stage, name));
    await copyFile(join(root, "packages/renkin/README.md"), join(stage, "README.md"));
    await mkdir(join(stage, "docs"), { recursive: true });
    for (const source of await walkFiles(join(root, "docs"))) {
      if (!source.endsWith(".md")) continue;
      const destination = join(stage, "docs", relative(join(root, "docs"), source));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    for (const target of Object.values(manifest.bin)) await chmod(resolve(stage, target), 0o755);
    return manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};
