import { join } from "node:path";
import { Effect } from "effect";
import { sha256File } from "./build-info.ts";
import type { ReleaseService } from "./github-release-service.ts";
import type { PreparedRelease } from "./prepare-release.ts";
import { ReleaseError } from "./release-error.ts";
import { mkdir, readFile, writeFile } from "./release-files.ts";
import { releaseCommand } from "./release-git.ts";

export const verifyCanonicalArtifact = (root: string, prepared: PreparedRelease) =>
  Effect.gen(function* () {
    const directory = join(root, ".renkin/release");
    const archive = join(directory, `renkin-${prepared.version}.tgz`);
    const record = JSON.parse(yield* readFile(join(directory, "artifact.json"), "utf8"));
    if (
      record.source.sourceRevision !== prepared.revision ||
      record.source.sourceDirty !== false ||
      record.source.lockSha256 !== (yield* sha256File(join(root, "bun.lock"))) ||
      record.sha256 !== (yield* sha256File(archive))
    )
      return yield* Effect.fail(
        new ReleaseError("Canonical artifact identity does not match the release commit."),
      );
    const manifest = JSON.parse(
      yield* releaseCommand(root, "tar", ["-xOf", archive, "package/package.json"]),
    );
    if (manifest.name !== "@carere/renkin" || manifest.version !== prepared.version)
      return yield* Effect.fail(
        new ReleaseError("Canonical artifact package version is incorrect."),
      );
    return archive;
  });

/** A single completed asset checkpoints both the tarball and its identity record atomically. */
export const canonicalArtifact = (
  root: string,
  prepared: PreparedRelease,
  host: ReleaseService,
  build: () => Effect.Effect<void, ReleaseError>,
) =>
  Effect.gen(function* () {
    const directory = join(root, ".renkin/release");
    yield* mkdir(directory, { recursive: true });
    const release =
      (yield* host.find(`v${prepared.version}`)) ??
      (yield* host.create(`v${prepared.version}`, prepared.revision));
    const name = `renkin-${prepared.version}-bundle.tar`;
    const bundle = join(directory, name);
    const existing = release.assets.find((asset) => asset.name === name);
    const files = ["artifact.json", `renkin-${prepared.version}.tgz`];
    if (existing?.state === "uploaded") {
      yield* writeFile(bundle, yield* host.download(existing));
      const entries = (yield* releaseCommand(root, "tar", ["-tf", bundle])).split("\n").sort();
      if (JSON.stringify(entries) !== JSON.stringify([...files].sort()))
        return yield* Effect.fail(new ReleaseError("Invalid canonical release bundle entries."));
      yield* releaseCommand(root, "tar", ["-xf", bundle, "-C", directory]);
    } else {
      if (!release.draft || release.assets.some((asset) => asset.state === "uploaded"))
        return yield* Effect.fail(
          new ReleaseError(
            "Release already contains assets without a canonical bundle; refusing to rebuild it.",
          ),
        );
      if (existing) yield* host.discardIncomplete(existing);
      yield* build();
      yield* verifyCanonicalArtifact(root, prepared);
      yield* releaseCommand(root, "tar", ["-cf", bundle, "-C", directory, ...files]);
      yield* host.upload(release, name, yield* readFile(bundle));
    }
    return yield* verifyCanonicalArtifact(root, prepared);
  });
