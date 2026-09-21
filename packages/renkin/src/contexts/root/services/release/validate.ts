import { access, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { walkFiles } from "./layout.ts";
import { moduleSpecifiers } from "./module-specifiers.ts";

const prohibited = /^(?:@renkin\/|alchemy(?:\/|$)|@alchemy\.run\/|@carere\/alchemy(?:\/|$))/;
const exists = async (path: string) => {
  await access(path);
  return path;
};
const contained = (root: string, path: string) => {
  const name = relative(root, path);
  if (name.startsWith("..") || isAbsolute(name))
    throw new Error(`Release path escapes its package: ${path}`);
};
export const validateRelease = async (stage: string, checkout?: string) => {
  const manifest = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
  if (manifest.name !== "renkin" || manifest.type !== "module" || manifest.license !== "Apache-2.0")
    throw new Error("Invalid release manifest identity.");
  if (!manifest.peerDependencies?.effect || manifest.dependencies?.effect)
    throw new Error("Effect must be an external compatible peer.");
  const serialized = JSON.stringify(manifest);
  if (/workspace:|@renkin\/|npm:(?:alchemy|@alchemy\.run\/|@carere\/alchemy)/.test(serialized))
    throw new Error("Release metadata contains private or prohibited dependencies.");
  for (const name of Object.keys(manifest.dependencies ?? {}))
    if (prohibited.test(name)) throw new Error(`Prohibited release dependency: ${name}`);
  for (const conditions of Object.values(manifest.exports) as {
    types: string;
    import: string;
    default: string;
  }[]) {
    for (const path of Object.values(conditions)) {
      const target = resolve(stage, path);
      contained(stage, target);
      await exists(target);
    }
    if (!conditions.types.endsWith(".d.ts") || !conditions.import.endsWith(".js"))
      throw new Error("Release exports must reference JS and declarations.");
  }
  for (const path of Object.values(manifest.bin) as string[]) {
    const target = resolve(stage, path);
    contained(stage, target);
    if (
      !((await stat(target)).mode & 0o111) ||
      !(await readFile(target, "utf8")).startsWith("#!/usr/bin/env bun")
    )
      throw new Error("Release CLI is not an executable Bun entrypoint.");
  }
  let references = 0;
  const files = await walkFiles(stage);
  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const source = await readFile(file, "utf8");
    if (checkout && source.includes(checkout)) throw new Error(`Checkout path leaked into ${file}`);
    for (const { value } of moduleSpecifiers(source)) {
      if (prohibited.test(value)) throw new Error(`Private/prohibited import leaked: ${value}`);
      if (!value.startsWith(".")) continue;
      const target = resolve(dirname(file), value);
      contained(stage, target);
      await exists(target);
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
    await exists(join(stage, name));
  return { files: files.length, references, subpaths: Object.keys(manifest.exports) };
};
