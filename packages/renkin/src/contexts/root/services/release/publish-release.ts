import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReleaseService } from "./github-release-service.ts";
import type { PreparedRelease } from "./prepare-release.ts";

export interface PackageRegistry {
  integrity(version: string): Promise<string | undefined>;
  publish(archive: string): Promise<void>;
}
/** Resume npm-success/GitHub-failure without attempting an immutable npm version twice. */
export const publishRelease = async (
  prepared: PreparedRelease,
  archive: string,
  host: ReleaseService,
  registry: PackageRegistry,
) => {
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`;
  const published = await registry.integrity(prepared.version);
  if (published !== undefined && published !== integrity)
    throw new Error(
      "npm version exists with a different artifact; refusing to overwrite or finalize it.",
    );
  if (published === undefined) await registry.publish(archive);
  const release = await host.find(`v${prepared.version}`);
  if (!release) throw new Error("Canonical GitHub release is missing.");
  if (release.draft) await host.publish(release);
};
