import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256File } from "./build-info.ts";
import type { ReleaseService } from "./github-release-service.ts";
import type { PreparedRelease } from "./prepare-release.ts";
import { releaseCommand } from "./release-git.ts";

export const verifyCanonicalArtifact = async (root: string, prepared: PreparedRelease) => {
  const directory = join(root, ".renkin/release");
  const archive = join(directory, `renkin-${prepared.version}.tgz`);
  const record = JSON.parse(await readFile(join(directory, "artifact.json"), "utf8"));
  if (
    record.source.sourceRevision !== prepared.revision ||
    record.source.sourceDirty !== false ||
    record.source.lockSha256 !== (await sha256File(join(root, "bun.lock"))) ||
    record.sha256 !== (await sha256File(archive))
  )
    throw new Error("Canonical artifact identity does not match the release commit.");
  const manifest = JSON.parse(
    await releaseCommand(root, "tar", ["-xOf", archive, "package/package.json"]),
  );
  if (manifest.name !== "@carere/renkin" || manifest.version !== prepared.version)
    throw new Error("Canonical artifact package version is incorrect.");
  return archive;
};

/** A single completed asset checkpoints both the tarball and its identity record atomically. */
export const canonicalArtifact = async (
  root: string,
  prepared: PreparedRelease,
  host: ReleaseService,
  build: () => Promise<void>,
) => {
  const directory = join(root, ".renkin/release");
  await mkdir(directory, { recursive: true });
  const release =
    (await host.find(`v${prepared.version}`)) ??
    (await host.create(`v${prepared.version}`, prepared.revision));
  const name = `renkin-${prepared.version}-bundle.tar`;
  const bundle = join(directory, name);
  const existing = release.assets.find((asset) => asset.name === name);
  const files = ["artifact.json", `renkin-${prepared.version}.tgz`];
  if (existing?.state === "uploaded") {
    await writeFile(bundle, await host.download(existing));
    const entries = (await releaseCommand(root, "tar", ["-tf", bundle])).split("\n").sort();
    if (JSON.stringify(entries) !== JSON.stringify([...files].sort()))
      throw new Error("Invalid canonical release bundle entries.");
    await releaseCommand(root, "tar", ["-xf", bundle, "-C", directory]);
  } else {
    if (!release.draft || release.assets.some((asset) => asset.state === "uploaded"))
      throw new Error(
        "Release already contains assets without a canonical bundle; refusing to rebuild it.",
      );
    if (existing) await host.discardIncomplete(existing);
    await build();
    await verifyCanonicalArtifact(root, prepared);
    await releaseCommand(root, "tar", ["-cf", bundle, "-C", directory, ...files]);
    await host.upload(release, name, await readFile(bundle));
  }
  return verifyCanonicalArtifact(root, prepared);
};
