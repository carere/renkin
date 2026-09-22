import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export const sha256File = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export const buildInfo = async (root: string) => {
  const execute = promisify(execFile);
  const [{ stdout: revision }, { stdout: status }, lockSha256] = await Promise.all([
    execute("git", ["rev-parse", "HEAD"], { cwd: root }),
    execute("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root }),
    sha256File(join(root, "bun.lock")),
  ]);
  return {
    sourceRevision: revision.trim(),
    sourceDirty: status.trim().length > 0,
    lockSha256,
    runtime: `Bun ${process.versions.bun ?? "unavailable"}`,
  };
};
