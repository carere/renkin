import { join } from "node:path";
import { Effect } from "effect";
import { ReleaseError } from "./release-error.ts";
import { writeFile } from "./release-files.ts";
import { releaseCommand, releaseGit, releaseSource } from "./release-git.ts";
import { bumpArguments, compareVersions } from "./version.ts";

export interface PreparedRelease {
  readonly version: string;
  readonly revision: string;
  readonly source: string;
}
const recorded = (root: string, revision: string) =>
  Effect.gen(function* () {
    const git = releaseGit(root);
    const manifest = JSON.parse(yield* git.run("show", `${revision}:packages/renkin/package.json`));
    if ((yield* git.ref(`v${manifest.version}`)) !== revision)
      return yield* Effect.fail(new ReleaseError("Release tag and run checkpoint disagree."));
    return { version: manifest.version, revision, source: yield* releaseSource(root, revision) };
  });

/** Reserve a version and a stable per-run checkpoint in one atomic push. Never write main. */
export const prepareRelease = (
  root: string,
  options: {
    readonly runId: string;
    readonly requested?: string;
  },
) =>
  Effect.gen(function* () {
    if (!/^\d+$/.test(options.runId))
      return yield* Effect.fail(new ReleaseError("Invalid workflow run ID."));
    const git = releaseGit(root);
    yield* git.run("fetch", "origin", "main", "--tags");
    const runTag = `release-run-${options.runId}`;
    const resumed = yield* git.ref(runTag);
    if (resumed) return yield* recorded(root, resumed);
    if (yield* git.run("status", "--porcelain"))
      return yield* Effect.fail(new ReleaseError("Release preparation requires a clean checkout."));
    const source = yield* git.run("rev-parse", "origin/main");
    const current = (yield* git.versions()).at(-1);
    if (!current)
      return yield* Effect.fail(
        new ReleaseError(
          "Initial release needs an existing version tag before automatic release preparation.",
        ),
      );
    const baseline = yield* git.run("rev-parse", `v${current}^{commit}`);
    const baselineSource = yield* releaseSource(root, baseline);
    yield* git.run("merge-base", "--is-ancestor", baselineSource, source);
    if (!options.requested && baselineSource === source) {
      yield* git.run("tag", runTag, baseline);
      yield* git.run("push", "origin", `refs/tags/${runTag}`);
      return yield* recorded(root, baseline);
    }
    const args = yield* Effect.try({
      try: () => bumpArguments(current, options.requested),
      catch: (cause) => new ReleaseError(String(cause)),
    });
    yield* git.run("checkout", "-B", "main", source);
    // Preserve release ancestry so Cocogitto only considers commits after the previous release.
    yield* git.run("merge", "--no-commit", "--no-ff", "-s", "ours", `v${current}`);
    if (yield* git.run("ls-tree", "--name-only", baseline, "CHANGELOG.md")) {
      yield* writeFile(
        join(root, "CHANGELOG.md"),
        `${yield* git.run("show", `${baseline}:CHANGELOG.md`)}\n`,
      );
      yield* git.run("add", "CHANGELOG.md");
    }
    yield* writeFile(
      join(root, ".release-source.json"),
      `${JSON.stringify({ source }, null, 2)}\n`,
    );
    yield* git.run("add", ".release-source.json");
    yield* git.run("commit", "--allow-empty", "-m", "merge: prepare release source");
    const selected = (yield* releaseCommand(root, "cog", ["bump", ...args, "--dry-run"])).replace(
      /^v/,
      "",
    );
    if (compareVersions(selected, current) <= 0)
      return yield* Effect.fail(
        new ReleaseError(
          `Cocogitto did not select a version newer than ${current}; supply an explicit version.`,
        ),
      );
    yield* releaseCommand(root, "cog", ["bump", "--version", selected]);
    const revision = yield* git.run("rev-parse", "HEAD");
    const release = yield* recorded(root, revision);
    yield* git.run("tag", runTag, revision);
    yield* git.run("push", "--atomic", "origin", `refs/tags/v${selected}`, `refs/tags/${runTag}`);
    return release;
  });
