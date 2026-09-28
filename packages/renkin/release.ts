import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { assembleRelease } from "#src/contexts/root/services/release/assemble.ts";
import { sha256File } from "#src/contexts/root/services/release/build-info.ts";
import { releaseAttempt } from "#src/contexts/root/services/release/release-error.ts";
import { releaseCommand } from "#src/contexts/root/services/release/release-git.ts";
import { validateRelease } from "#src/contexts/root/services/release/validate.ts";

await Effect.runPromise(
  Effect.gen(function* () {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const stage = join(root, ".renkin/release/package");
    const command = process.argv[2] ?? "pack";
    if (!["build", "pack", "check"].includes(command))
      throw new Error("Use release.ts build, pack or check.");
    if (command !== "check") yield* assembleRelease(root, stage);
    const result = yield* validateRelease(stage, root);
    if (command === "pack") {
      const { version } = yield* releaseAttempt(() => import(`${stage}/package.json`));
      const archive = join(root, ".renkin/release", `renkin-${version}.tgz`);
      yield* releaseCommand(stage, process.execPath, ["pm", "pack", "--filename", archive]);
      const record = {
        ...result,
        archive,
        sha256: yield* sha256File(archive),
        source: JSON.parse(
          yield* releaseAttempt(() => readFile(join(stage, "BUILD_INFO.json"), "utf8")),
        ),
      };
      yield* releaseAttempt(() =>
        writeFile(
          join(root, ".renkin/release/artifact.json"),
          `${JSON.stringify(record, null, 2)}\n`,
        ),
      );
      console.info(JSON.stringify(record));
    } else console.info(JSON.stringify({ ...result, stage }));
  }),
);
