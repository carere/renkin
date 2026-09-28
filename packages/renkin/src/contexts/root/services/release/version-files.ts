import { join } from "node:path";
import { Effect } from "effect";
import { ReleaseError } from "./release-error.ts";
import { readFile, writeFile } from "./release-files.ts";
import { parseVersion } from "./version.ts";

/** Bump only the public workspace identity; never re-resolve unrelated dependencies. */
export const updateVersionFiles = (root: string, version: string) =>
  Effect.gen(function* () {
    parseVersion(version);
    const manifestPath = join(root, "packages/renkin/package.json");
    const lockPath = join(root, "bun.lock");
    const manifest = JSON.parse(yield* readFile(manifestPath, "utf8"));
    if (manifest.name !== "@carere/renkin")
      return yield* Effect.fail(new ReleaseError("Unexpected public package identity."));
    const lock = yield* readFile(lockPath, "utf8");
    const pattern =
      /("packages\/renkin":\s*\{\s*"name": "@carere\/renkin",\s*"version": ")[^"]+(")/;
    if (!pattern.test(lock))
      return yield* Effect.fail(new ReleaseError("Public workspace is missing from bun.lock."));
    yield* writeFile(manifestPath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
    yield* writeFile(lockPath, lock.replace(pattern, `$1${version}$2`));
  });
