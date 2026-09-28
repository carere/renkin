import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect } from "effect";
import { ReleaseError, releaseAttempt } from "./release-error.ts";
import { compareVersions, parseVersion } from "./version.ts";

/** Interruption aborts the native subprocess rather than leaving release mutations running. */
export const releaseCommand = (root: string, program: string, args: readonly string[]) =>
  releaseAttempt((signal) =>
    promisify(execFile)(program, [...args], { cwd: root, maxBuffer: 2_000_000, signal }),
  ).pipe(Effect.map(({ stdout }) => stdout.trim()));
export const releaseGit = (root: string) => ({
  run: (...args: string[]) => releaseCommand(root, "git", args),
  ref: (name: string) =>
    Effect.gen(function* () {
      const refs = yield* releaseCommand(root, "git", ["show-ref", "--tags"]);
      const line = refs.split("\n").find((line) => line.endsWith(` refs/tags/${name}`));
      return line
        ? yield* releaseCommand(root, "git", ["rev-parse", `${name}^{commit}`])
        : undefined;
    }),
  versions: () =>
    Effect.gen(function* () {
      const tags = yield* releaseCommand(root, "git", ["tag", "--list", "v*"]);
      return tags
        .split("\n")
        .flatMap((tag) => {
          try {
            parseVersion(tag.slice(1));
            return [tag.slice(1)];
          } catch {
            return [];
          }
        })
        .sort(compareVersions);
    }),
});
/** The marker lives only in release commits; older manually prepared tags use their commit as source. */
export const releaseSource = (root: string, revision: string) =>
  Effect.gen(function* () {
    const git = releaseGit(root);
    if (!(yield* git.run("ls-tree", "--name-only", revision, ".release-source.json")))
      return revision;
    const record = JSON.parse(yield* git.run("show", `${revision}:.release-source.json`));
    if (!/^[0-9a-f]{40}$/.test(record.source))
      return yield* Effect.fail(new ReleaseError("Invalid release source checkpoint."));
    return record.source as string;
  });
