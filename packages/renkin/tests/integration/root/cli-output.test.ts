import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";

it("routes user and framework writes away from the CLI JSON channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-cli-output-"));
  const policy = new URL("../../../src/contexts/root/cli/output.ts", import.meta.url).href;
  const entry = join(directory, "output.ts");
  await writeFile(
    entry,
    `import {routeCliOutput} from ${JSON.stringify(policy)};
const output=routeCliOutput();
console.log('framework progress');console.info('user progress');process.stdout.write('direct progress\\n');
output(JSON.stringify({complete:true}));`,
  );
  try {
    const result = await promisify(execFile)(process.versions.bun ? process.execPath : "bun", [
      "--no-env-file",
      entry,
    ]);
    expect(JSON.parse(result.stdout)).toEqual({ complete: true });
    expect(result.stderr).toContain("framework progress");
    expect(result.stderr).toContain("user progress");
    expect(result.stderr).toContain("direct progress");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps noisy external compiler stdout out of the CLI JSON channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-command-output-"));
  const policy = new URL("../../../src/contexts/root/cli/output.ts", import.meta.url).href;
  const api = new URL("../../../src/contexts/root/api.ts", import.meta.url).href;
  const compiler = join(directory, "compiler.ts");
  const entry = join(directory, "run.ts");
  await writeFile(
    compiler,
    `import {mkdir,writeFile} from 'node:fs/promises';
console.log('compiler stdout');console.error('compiler stderr');
await mkdir('dist',{recursive:true});await writeFile('dist/entry.mjs','export default {};');
await writeFile('.renkin/result.json',JSON.stringify({entry:'dist/entry.mjs'}));`,
  );
  await writeFile(
    entry,
    `import {routeCliOutput} from ${JSON.stringify(policy)};
import {buildCommand} from ${JSON.stringify(api)};
const output=routeCliOutput();
const recipe=buildCommand({cwd:${JSON.stringify(directory)},command:[process.execPath,'--no-env-file',${JSON.stringify(compiler)}],manifest:'.renkin/result.json'});
await recipe.build();output(JSON.stringify({complete:true}));`,
  );
  try {
    const result = await promisify(execFile)(process.versions.bun ? process.execPath : "bun", [
      "--no-env-file",
      entry,
    ]);
    expect(JSON.parse(result.stdout)).toEqual({ complete: true });
    expect(result.stderr).toContain("compiler stdout");
    expect(result.stderr).toContain("compiler stderr");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
