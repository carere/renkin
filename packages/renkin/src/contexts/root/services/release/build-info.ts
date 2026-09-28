import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { readFile } from "./release-files.ts";
import { releaseCommand } from "./release-git.ts";

export const sha256File = (path: string) =>
  readFile(path).pipe(Effect.map((bytes) => createHash("sha256").update(bytes).digest("hex")));
export const buildInfo = (root: string) =>
  Effect.gen(function* () {
    const [revision, status, lockSha256] = yield* Effect.all(
      [
        releaseCommand(root, "git", ["rev-parse", "HEAD"]),
        releaseCommand(root, "git", ["status", "--porcelain", "--untracked-files=normal"]),
        sha256File(join(root, "bun.lock")),
      ],
      { concurrency: "unbounded" },
    );
    return {
      sourceRevision: revision,
      sourceDirty: status.length > 0,
      lockSha256,
      runtime: `Bun ${process.versions.bun ?? "unavailable"}`,
    };
  });
