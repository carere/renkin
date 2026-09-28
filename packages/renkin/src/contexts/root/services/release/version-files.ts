import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseVersion } from "./version.ts";

/** Bump only the public workspace identity; never re-resolve unrelated dependencies. */
export const updateVersionFiles = async (root: string, version: string) => {
  parseVersion(version);
  const manifestPath = join(root, "packages/renkin/package.json");
  const lockPath = join(root, "bun.lock");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== "@carere/renkin") throw new Error("Unexpected public package identity.");
  const lock = await readFile(lockPath, "utf8");
  const pattern = /("packages\/renkin":\s*\{\s*"name": "@carere\/renkin",\s*"version": ")[^"]+(")/;
  if (!pattern.test(lock)) throw new Error("Public workspace is missing from bun.lock.");
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  await writeFile(lockPath, lock.replace(pattern, `$1${version}$2`));
};
