import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";
import { emptyState } from "@renkin/core/models/state";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import { Effect } from "effect";

it.effect("reads JSON in another process without evaluating the infrastructure file", () =>
  Effect.promise(async () => {
    const directory = await mkdtemp(join(tmpdir(), "renkin-cli-"));
    const stateDirectory = join(directory, ".renkin");
    const repository = new FileStateRepository(stateDirectory);
    const lease = await repository.acquire("app", "dev");
    try {
      const state = emptyState("app", "dev");
      state.outputs.message = { value: "hello" };
      state.outputs.password = { value: "do-not-print", secret: true };
      await lease.write(state);
    } finally {
      await lease.release();
    }
    await writeFile(
      join(directory, "renkin.ts"),
      'throw new Error("Infrastructure must not be evaluated");',
    );
    const cli = new URL("../../../src/contexts/root/cli/main.ts", import.meta.url).pathname;
    const executable = process.versions.bun ? process.execPath : "bun";
    const run = async (command: string) =>
      promisify(execFile)(
        executable,
        [cli, command, "--stack", "app", "--env", "dev", "--local", "--state-dir", stateDirectory],
        { cwd: directory },
      );
    try {
      const listed = await run("list");
      expect(JSON.parse(listed.stdout)).toEqual(["dev"]);
      expect(listed.stderr).toBe("");
      const outputs = await run("outputs");
      expect(JSON.parse(outputs.stdout)).toEqual({ message: "hello", password: "[REDACTED]" });
      expect(outputs.stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }),
);
