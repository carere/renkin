import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import { walkFiles } from "./layout.ts";
import { moduleSpecifiers } from "./module-specifiers.ts";
import { ReleaseError } from "./release-error.ts";
import { access, readFile, stat } from "./release-files.ts";

const prohibited = /^(?:@renkin\/|alchemy(?:\/|$)|@alchemy\.run\/|@carere\/alchemy(?:\/|$))/;
const exists = (path: string) =>
  Effect.gen(function* () {
    yield* access(path);
    return path;
  });
const contained = (root: string, path: string) => {
  const name = relative(root, path);
  if (name.startsWith("..") || isAbsolute(name))
    throw new Error(`Release path escapes its package: ${path}`);
};
const validatedManifest = (stage: string) =>
  Effect.gen(function* () {
    const manifest = JSON.parse(yield* readFile(join(stage, "package.json"), "utf8"));
    if (
      manifest.name !== "@carere/renkin" ||
      manifest.type !== "module" ||
      manifest.license !== "Apache-2.0"
    )
      return yield* Effect.fail(new ReleaseError("Invalid release manifest identity."));
    if (!manifest.peerDependencies?.effect || manifest.dependencies?.effect)
      return yield* Effect.fail(new ReleaseError("Effect must be an external compatible peer."));
    const serialized = JSON.stringify(manifest);
    if (/workspace:|@renkin\/|npm:(?:alchemy|@alchemy\.run\/|@carere\/alchemy)/.test(serialized))
      return yield* Effect.fail(
        new ReleaseError("Release metadata contains private or prohibited dependencies."),
      );
    for (const name of Object.keys(manifest.dependencies ?? {}))
      if (prohibited.test(name))
        return yield* Effect.fail(new ReleaseError(`Prohibited release dependency: ${name}`));
    return manifest;
  });
export const validateRelease = (stage: string, checkout?: string) =>
  Effect.gen(function* () {
    const manifest = yield* validatedManifest(stage);
    for (const conditions of Object.values(manifest.exports) as {
      types: string;
      import: string;
      default: string;
    }[]) {
      for (const path of Object.values(conditions)) {
        const target = resolve(stage, path);
        contained(stage, target);
        yield* exists(target);
      }
      if (!conditions.types.endsWith(".d.ts") || !conditions.import.endsWith(".js"))
        return yield* Effect.fail(
          new ReleaseError("Release exports must reference JS and declarations."),
        );
    }
    for (const path of Object.values(manifest.bin) as string[]) {
      const target = resolve(stage, path);
      contained(stage, target);
      if (
        !((yield* stat(target)).mode & 0o111) ||
        !(yield* readFile(target, "utf8")).startsWith("#!/usr/bin/env bun")
      )
        return yield* Effect.fail(
          new ReleaseError("Release CLI is not an executable Bun entrypoint."),
        );
    }
    let references = 0;
    const files = yield* walkFiles(stage);
    for (const file of files) {
      if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
      const source = yield* readFile(file, "utf8");
      if (checkout && source.includes(checkout))
        return yield* Effect.fail(new ReleaseError(`Checkout path leaked into ${file}`));
      for (const { value } of moduleSpecifiers(source)) {
        if (value.startsWith("#"))
          return yield* Effect.fail(new ReleaseError(`Unresolved project alias leaked: ${value}`));
        if (prohibited.test(value))
          return yield* Effect.fail(new ReleaseError(`Private/prohibited import leaked: ${value}`));
        if (!value.startsWith(".")) continue;
        const target = resolve(dirname(file), value);
        contained(stage, target);
        yield* exists(target);
        references++;
      }
    }
    for (const name of [
      "LICENSE",
      "NOTICE",
      "SOURCE_PROVENANCE.md",
      "BUILD_INFO.json",
      "THIRD_PARTY_NOTICES.md",
      "README.md",
    ])
      yield* exists(join(stage, name));
    return { files: files.length, references, subpaths: Object.keys(manifest.exports) };
  });
