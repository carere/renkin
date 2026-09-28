import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { ReleaseService } from "./github-release-service.ts";
import type { PreparedRelease } from "./prepare-release.ts";
import { ReleaseError } from "./release-error.ts";
import { readFile } from "./release-files.ts";

export interface PackageRegistry {
  integrity(version: string): Effect.Effect<string | undefined, ReleaseError>;
  publish(archive: string): Effect.Effect<void, ReleaseError>;
}
/** Resume npm-success/GitHub-failure without attempting an immutable npm version twice. */
export const publishRelease = (
  prepared: PreparedRelease,
  archive: string,
  host: ReleaseService,
  registry: PackageRegistry,
) =>
  Effect.gen(function* () {
    const integrity = `sha512-${createHash("sha512")
      .update(yield* readFile(archive))
      .digest("base64")}`;
    const published = yield* registry.integrity(prepared.version);
    if (published !== undefined && published !== integrity)
      return yield* Effect.fail(
        new ReleaseError(
          "npm version exists with a different artifact; refusing to overwrite or finalize it.",
        ),
      );
    if (published === undefined) yield* registry.publish(archive);
    const release = yield* host.find(`v${prepared.version}`);
    if (!release)
      return yield* Effect.fail(new ReleaseError("Canonical GitHub release is missing."));
    if (release.draft) yield* host.publish(release);
  });
