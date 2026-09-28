import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compareVersions, parseVersion } from "./version.ts";

export const releaseCommand = async (root: string, program: string, args: readonly string[]) =>
  (
    await promisify(execFile)(program, [...args], { cwd: root, maxBuffer: 2_000_000 })
  ).stdout.trim();

export const releaseGit = (root: string) => ({
  run: (...args: string[]) => releaseCommand(root, "git", args),
  async ref(name: string) {
    const refs = await releaseCommand(root, "git", ["show-ref", "--tags"]);
    const line = refs.split("\n").find((line) => line.endsWith(` refs/tags/${name}`));
    return line ? releaseCommand(root, "git", ["rev-parse", `${name}^{commit}`]) : undefined;
  },
  async versions() {
    const tags = await releaseCommand(root, "git", ["tag", "--list", "v*"]);
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
  },
});

/** The marker lives only in release commits; older manually prepared tags use their commit as source. */
export const releaseSource = async (root: string, revision: string) => {
  const git = releaseGit(root);
  const files = await git.run("ls-tree", "--name-only", revision, ".release-source.json");
  if (!files) return revision;
  const record = JSON.parse(await git.run("show", `${revision}:.release-source.json`));
  if (!/^[0-9a-f]{40}$/.test(record.source)) throw new Error("Invalid release source checkpoint.");
  return record.source as string;
};
