import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute, type InstalledConsumer } from "./consumer.ts";

const compile = async (consumer: InstalledConsumer, file: string, skip: boolean) => {
  const args = [
    "node_modules/typescript/bin/tsc",
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    String(skip),
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--target",
    "ESNext",
    "--lib",
    "ESNext,DOM",
    "--types",
    "node",
    file,
  ];
  try {
    await execute(process.execPath, args, {
      cwd: consumer.directory,
      env: consumer.env,
      maxBuffer: 2000000,
    });
    return [];
  } catch (error) {
    if (!error || typeof error !== "object" || !("stdout" in error)) throw error;
    const diagnostics = String(error.stdout).trim().split("\n").filter(Boolean).sort();
    if (!diagnostics.length || diagnostics.some((line) => !/error TS[0-9]+:/.test(line)))
      throw new Error(`Type checking ${file} failed:\n${String(error.stdout)}`, { cause: error });
    return diagnostics;
  }
};
export const verifyTypes = async (consumer: InstalledConsumer) => {
  const entrypoints = [
    "@carere/renkin",
    "@carere/renkin/cloudflare",
    "@carere/renkin/worker",
    "@carere/renkin/testing",
    "@carere/renkin/durable-object",
    "@carere/renkin/workflow",
    "@carere/renkin/astro",
    "@carere/renkin/vite",
  ];
  await writeFile(
    join(consumer.directory, "all-types.ts"),
    entrypoints
      .map((name, i) => `import * as entry${i} from ${JSON.stringify(name)}; void entry${i};`)
      .join("\n"),
  );
  assert.deepEqual(await compile(consumer, "all-types.ts", true), []);
  assert.deepEqual(await compile(consumer, "worker-types.test.ts", true), []);
  assert.deepEqual(await compile(consumer, "site-environment.test.ts", true), []);
  assert.deepEqual(await compile(consumer, "value-types.test.ts", true), []);
  await writeFile(
    join(consumer.directory, "core-types.ts"),
    ["@carere/renkin", "@carere/renkin/worker", "@carere/renkin/testing"]
      .map((name, i) => `import * as entry${i} from ${JSON.stringify(name)}; void entry${i};`)
      .join("\n"),
  );
  assert.deepEqual(await compile(consumer, "core-types.ts", false), []);
  await writeFile(
    join(consumer.directory, "astro-types.ts"),
    "import type { AstroInlineConfig } from 'astro'; export const config: AstroInlineConfig = {site:'https://example.com'};\n",
  );
  const all = await compile(consumer, "all-types.ts", false);
  const direct = await compile(consumer, "astro-types.ts", false);
  assert.deepEqual(
    all,
    direct,
    "Renkin must introduce no additional declaration diagnostics beyond direct Astro",
  );
  return { upstreamAstroDiagnostics: direct.length, renkinOnlyDiagnostics: 0 };
};
