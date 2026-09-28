import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { prepareRelease } from "#src/contexts/root/services/release/prepare-release.ts";
import { mkdtemp, readFile, rm } from "#src/contexts/root/services/release/release-files.ts";
import { releaseCommand } from "#src/contexts/root/services/release/release-git.ts";

it.live("keeps release validation failures in the Effect error channel", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(prepareRelease("unused", { runId: "invalid" }));
    expect(error._tag).toBe("ReleaseError");
    expect(error.message).toContain("workflow run ID");
  }),
);

it.live("starts commands lazily and stops their subprocess on interruption", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      mkdtemp(join(tmpdir(), "renkin-release-effect-")),
      (path) => rm(path, { recursive: true, force: true }).pipe(Effect.orDie),
    );
    const marker = join(directory, "pid");
    const command = releaseCommand(directory, process.execPath, [
      "--no-env-file",
      "-e",
      'require("node:fs").writeFileSync("pid", String(process.pid));setInterval(()=>{},1000);',
    ]);
    expect(existsSync(marker)).toBe(false);
    const fiber = yield* Effect.forkChild(command);
    while (!existsSync(marker)) yield* Effect.sleep("10 millis");
    const pid = Number(yield* readFile(marker, "utf8"));
    yield* Fiber.interrupt(fiber);
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; alive() && attempt < 100; attempt++) yield* Effect.sleep("10 millis");
    expect(alive()).toBe(false);
  }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
);
