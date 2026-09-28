import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { releaseCommand, releaseGit, releaseSource } from "./release-git.ts";
import { bumpArguments, compareVersions } from "./version.ts";

export interface PreparedRelease {
  readonly version: string;
  readonly revision: string;
  readonly source: string;
}
const recorded = async (root: string, revision: string): Promise<PreparedRelease> => {
  const git = releaseGit(root);
  const manifest = JSON.parse(await git.run("show", `${revision}:packages/renkin/package.json`));
  if ((await git.ref(`v${manifest.version}`)) !== revision)
    throw new Error("Release tag and run checkpoint disagree.");
  return { version: manifest.version, revision, source: await releaseSource(root, revision) };
};

/** Reserve a version and a stable per-run checkpoint in one atomic push. Never write main. */
export const prepareRelease = async (
  root: string,
  options: {
    readonly runId: string;
    readonly requested?: string;
  },
): Promise<PreparedRelease> => {
  if (!/^\d+$/.test(options.runId)) throw new Error("Invalid workflow run ID.");
  const git = releaseGit(root);
  await git.run("fetch", "origin", "main", "--tags");
  const runTag = `release-run-${options.runId}`;
  const resumed = await git.ref(runTag);
  if (resumed) return recorded(root, resumed);
  if (await git.run("status", "--porcelain"))
    throw new Error("Release preparation requires a clean checkout.");
  const source = await git.run("rev-parse", "origin/main");
  const current = (await git.versions()).at(-1);
  if (!current)
    throw new Error(
      "Initial release needs an existing version tag before automatic release preparation.",
    );
  const baseline = await git.run("rev-parse", `v${current}^{commit}`);
  const baselineSource = await releaseSource(root, baseline);
  await git.run("merge-base", "--is-ancestor", baselineSource, source);
  if (!options.requested && baselineSource === source) {
    await git.run("tag", runTag, baseline);
    await git.run("push", "origin", `refs/tags/${runTag}`);
    return recorded(root, baseline);
  }
  const args = bumpArguments(current, options.requested);
  await git.run("checkout", "-B", "main", source);
  // Preserve release ancestry so Cocogitto only considers commits after the previous release.
  await git.run("merge", "--no-commit", "--no-ff", "-s", "ours", `v${current}`);
  if (await git.run("ls-tree", "--name-only", baseline, "CHANGELOG.md")) {
    await writeFile(
      join(root, "CHANGELOG.md"),
      `${await git.run("show", `${baseline}:CHANGELOG.md`)}\n`,
    );
    await git.run("add", "CHANGELOG.md");
  }
  await writeFile(join(root, ".release-source.json"), `${JSON.stringify({ source }, null, 2)}\n`);
  await git.run("add", ".release-source.json");
  await git.run("commit", "--allow-empty", "-m", "merge: prepare release source");
  const selected = (await releaseCommand(root, "cog", ["bump", ...args, "--dry-run"])).replace(
    /^v/,
    "",
  );
  if (compareVersions(selected, current) <= 0)
    throw new Error(
      `Cocogitto did not select a version newer than ${current}; supply an explicit version.`,
    );
  await releaseCommand(root, "cog", ["bump", "--version", selected]);
  const revision = await git.run("rev-parse", "HEAD");
  const release = await recorded(root, revision);
  await git.run("tag", runTag, revision);
  await git.run("push", "--atomic", "origin", `refs/tags/v${selected}`, `refs/tags/${runTag}`);
  return release;
};
