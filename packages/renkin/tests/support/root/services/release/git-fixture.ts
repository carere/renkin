import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { releaseCommand } from "#src/contexts/root/services/release/release-git.ts";

export const gitFixture = (version = "0.1.0-rc.1") =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "renkin-release-git-"));
      const remote = join(directory, "remote.git");
      const source = join(directory, "source");
      const repository = fileURLToPath(new URL("../../../../../../..", import.meta.url));
      const command = (root: string, ...args: string[]) =>
        Effect.runPromise(releaseCommand(root, "git", args));
      await command(directory, "init", "--bare", remote);
      await command(directory, "init", "-b", "main", source);
      await command(source, "config", "user.name", "Release test");
      await command(source, "config", "user.email", "release@example.test");
      await mkdir(join(source, "packages/renkin"), { recursive: true });
      await writeFile(
        join(source, "packages/renkin/package.json"),
        JSON.stringify({ name: "@carere/renkin", version }),
      );
      await writeFile(
        join(source, "bun.lock"),
        `{"workspaces":{"packages/renkin":{"name": "@carere/renkin", "version": "${version}"}},"packages":{"untouched":["dependency@1.0.0"]}}\n`,
      );
      await writeFile(
        join(source, "cog.toml"),
        await readFile(join(repository, "cog.toml"), "utf8"),
      );
      const helper = join(
        repository,
        "packages/renkin/src/contexts/root/services/release/version-files.ts",
      );
      await writeFile(
        join(source, "packages/renkin/release-version.ts"),
        `import {Effect} from ${JSON.stringify(join(repository, "node_modules/effect/dist/index.js"))};import {updateVersionFiles} from ${JSON.stringify(helper)};await Effect.runPromise(updateVersionFiles(process.cwd(),process.argv[2]));`,
      );
      await command(source, "add", ".");
      await command(source, "commit", "-m", "feat: initial");
      await command(source, "tag", `v${version}`);
      await command(source, "remote", "add", "origin", remote);
      await command(source, "push", "origin", "main", "--tags");
      let count = 0;
      return {
        directory,
        remote,
        source,
        command,
        change: async (message = "fix: change") => {
          await writeFile(join(source, "feature.txt"), String(++count));
          await command(source, "add", ".");
          await command(source, "commit", "-m", message);
          await command(source, "push", "origin", "main");
          return command(source, "rev-parse", "HEAD");
        },
        checkout: async () => {
          const path = join(directory, `runner-${++count}`);
          await command(directory, "clone", "--branch", "main", remote, path);
          await command(path, "config", "user.name", "Release test");
          await command(path, "config", "user.email", "release@example.test");
          return path;
        },
      };
    }),
    ({ directory }) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );
