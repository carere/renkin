import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateRelease } from "../../../../src/contexts/root/services/release/validate.ts";
import { execute, type InstalledConsumer } from "./consumer.ts";

export const verifyPackage = async (consumer: InstalledConsumer, archive: string) => {
  await validateRelease(join(consumer.directory, "node_modules/renkin"));
  const entries = (await execute("tar", ["-tf", archive])).stdout.trim().split("\n");
  assert.ok(entries.length > 100);
  assert.ok(
    entries.every(
      (entry) =>
        entry.startsWith("package/") && !entry.includes("../") && !entry.includes("node_modules"),
    ),
  );
  assert.ok(
    !entries.some((entry) => /(?:tests\/|services\/release\/|\.tsbuildinfo|\.env)/.test(entry)),
  );
  const manifest = JSON.parse(
    await readFile(join(consumer.directory, "node_modules/renkin/package.json"), "utf8"),
  );
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.dependencies.effect, undefined);
  assert.ok(!/workspace:|@renkin\/|alchemy/.test(JSON.stringify(manifest)));
  assert.equal(
    await realpath(join(consumer.directory, "node_modules/renkin")),
    join(await realpath(consumer.directory), "node_modules/renkin"),
  );
  const probe = `import assert from 'node:assert/strict'; import {createRequire} from 'node:module';
const here=createRequire(import.meta.url); const library=createRequire(import.meta.resolve('renkin'));
assert.equal(here.resolve('effect'),library.resolve('effect'));
for(const name of ['renkin','renkin/cloudflare','renkin/worker','renkin/testing','renkin/astro','renkin/vite']) await import(name);
console.log('installed imports and Effect identity passed');`;
  await writeFile(join(consumer.directory, "imports.ts"), probe);
  await execute(process.execPath, ["--no-env-file", "imports.ts"], {
    cwd: consumer.directory,
    env: consumer.env,
    maxBuffer: 200000,
  });
  const cli = join(consumer.directory, "node_modules/renkin", manifest.bin.renkin);
  const help = await execute(process.execPath, ["--no-env-file", cli, "help"], {
    cwd: consumer.directory,
    env: consumer.env,
  });
  assert.match(help.stdout, /Usage: renkin/);
  await writeFile(
    join(consumer.directory, "renkin.ts"),
    "throw new Error('Infrastructure must not be evaluated by read commands');\n",
  );
  const outputs = await execute(
    process.execPath,
    [
      "--no-env-file",
      cli,
      "outputs",
      "--local",
      "--stack",
      "missing",
      "--state-dir",
      join(consumer.directory, "state"),
    ],
    { cwd: consumer.directory, env: consumer.env },
  );
  assert.equal(JSON.parse(outputs.stdout), null);
  assert.equal(outputs.stderr, "");
  return { tarEntries: entries.length, subpaths: Object.keys(manifest.exports) };
};
