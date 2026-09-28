import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { Effect } from "effect";
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
import { ReleaseError, releaseAttempt } from "./release-error.ts";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "./release-files.ts";

const write = (path: string, source: string) =>
  Effect.gen(function* () {
    yield* mkdir(dirname(path), { recursive: true });
    yield* writeFile(path, source);
  });
const releaseRewriter =
  (root: string, stage: string, packages: readonly SourcePackage[]) =>
  (source: string, file: string, owner: SourcePackage) =>
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

export const assembleRelease = (root: string, stage: string) =>
  Effect.gen(function* () {
    const packages = yield* sourcePackages(root);
    const temporary = yield* Effect.acquireRelease(
      mkdtemp(join(tmpdir(), "renkin-declarations-")),
      (path) => rm(path, { recursive: true, force: true }).pipe(Effect.orDie),
    );
    yield* rm(stage, { recursive: true, force: true });
    yield* mkdir(stage, { recursive: true });
    const rewrite = releaseRewriter(root, stage, packages);
    for (const owner of packages)
      for (const source of yield* walkFiles(join(owner.directory, "src"))) {
        if (
          !source.endsWith(".ts") ||
          source.endsWith(".d.ts") ||
          source.includes("/services/release/")
        )
          continue;
        const destination = emittedPath(root, stage, source);
        const content = yield* readFile(source, "utf8");
        const { code } = yield* releaseAttempt(() =>
          transform(content, {
            loader: "ts",
            format: "esm",
            target: "es2022",
            legalComments: "inline",
          }),
        );
        yield* write(destination, rewrite(code, destination, owner));
      }
    const types = yield* emitDeclarations(root, temporary, packages);
    for (const source of yield* walkFiles(types)) {
      if (!source.endsWith(".d.ts")) continue;
      const destination = join(stage, "dist", relative(types, source));
      const owner = packages.find(({ directory }) =>
        relative(types, source).startsWith(`${relative(join(root, "packages"), directory)}/`),
      );
      if (!owner)
        return yield* Effect.fail(new ReleaseError(`Unknown declaration owner: ${source}`));
      yield* write(destination, rewrite(yield* readFile(source, "utf8"), destination, owner));
    }
    yield* write(
      join(stage, "BUILD_INFO.json"),
      `${JSON.stringify(yield* buildInfo(root), null, 2)}\n`,
    );
    const manifest = releaseManifest(root, stage, packages);
    yield* write(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const name of ["LICENSE", "NOTICE", "SOURCE_PROVENANCE.md", "THIRD_PARTY_NOTICES.md"])
      yield* copyFile(join(root, name), join(stage, name));
    yield* copyFile(join(root, "packages/renkin/README.md"), join(stage, "README.md"));
    yield* mkdir(join(stage, "docs"), { recursive: true });
    for (const source of yield* walkFiles(join(root, "docs"))) {
      if (!source.endsWith(".md")) continue;
      const destination = join(stage, "docs", relative(join(root, "docs"), source));
      yield* mkdir(dirname(destination), { recursive: true });
      yield* copyFile(source, destination);
    }
    for (const target of Object.values(manifest.bin)) yield* chmod(resolve(stage, target), 0o755);
    return manifest;
  }).pipe(Effect.scoped);
