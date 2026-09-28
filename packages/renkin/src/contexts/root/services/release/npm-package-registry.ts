import { Effect } from "effect";
import type { PackageRegistry } from "./publish-release.ts";
import { ReleaseError, releaseAttempt } from "./release-error.ts";
import { releaseCommand } from "./release-git.ts";

export const npmPackageRegistry = (root: string): PackageRegistry => ({
  integrity: (version) =>
    Effect.gen(function* () {
      const response = yield* releaseAttempt((signal) =>
        fetch(`https://registry.npmjs.org/@carere%2frenkin/${encodeURIComponent(version)}`, {
          signal,
        }),
      );
      if (response.status === 404) return undefined;
      if (!response.ok)
        return yield* Effect.fail(
          new ReleaseError(`npm version lookup failed (${response.status}).`),
        );
      const record = yield* releaseAttempt(() => response.json());
      if (typeof record.dist?.integrity !== "string")
        return yield* Effect.fail(new ReleaseError("npm version is missing artifact integrity."));
      return record.dist.integrity;
    }),
  publish: (file) =>
    releaseCommand(root, "npm", [
      "publish",
      file,
      "--registry",
      "https://registry.npmjs.org",
      "--access",
      "public",
      "--tag",
      "latest",
    ]).pipe(Effect.asVoid),
});
