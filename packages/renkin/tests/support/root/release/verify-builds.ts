import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute, type InstalledConsumer } from "./consumer.ts";

export const verifyBuilds = async (consumer: InstalledConsumer, root: string) => {
  await cp(
    new URL("./installed-builds.ts", import.meta.url),
    join(consumer.directory, "release-builds.ts"),
  );
  const reuse = await execute(process.execPath, ["--no-env-file", "release-builds.ts"], {
    cwd: consumer.directory,
    env: consumer.env,
    timeout: 90000,
    maxBuffer: 200000,
  });
  assert.match(reuse.stdout, /snapshot reuse and source-map invalidation passed/);
  const target = join(consumer.directory, "packages/renkin/tests/support/root/build");
  await mkdir(target, { recursive: true });
  await cp(
    join(root, "packages/renkin/tests/support/root/build/nesting-probe.ts"),
    join(target, "nesting-probe.ts"),
  );
  await mkdir(join(consumer.directory, ".moon"));
  await writeFile(
    join(consumer.directory, ".moon/workspace.yml"),
    "projects:\n  example-static: apps/example-static\ntelemetry: false\n",
  );
  await execute("git", ["init", "--quiet"], { cwd: consumer.directory, env: consumer.env });
  await execute(
    "git",
    [
      "-c",
      "user.name=Renkin release fixture",
      "-c",
      "user.email=release-fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "test: initialize installed consumer",
    ],
    { cwd: consumer.directory, env: consumer.env },
  );
  const nesting = await execute(
    process.execPath,
    ["--no-env-file", join(target, "nesting-probe.ts")],
    {
      cwd: consumer.directory,
      env: consumer.env,
      timeout: 90000,
      maxBuffer: 200000,
    },
  );
  assert.match(nesting.stdout, /Public Moon → Astro CLI nesting and verified reuse passed/);
  return "Installed snapshot/source-map recovery and Moon → Astro CLI passed.";
};
