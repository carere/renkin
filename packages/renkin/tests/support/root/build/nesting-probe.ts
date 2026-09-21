import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withBuildCommand } from "renkin";
import { buildAstro } from "renkin/astro";
import type { astro } from "renkin/cloudflare";

const resourceModule = new URL("../../../../../../apps/example-static/renkin.ts", import.meta.url);
const { site } = (await import(resourceModule.href)) as { site: ReturnType<typeof astro> };

const root = fileURLToPath(new URL("../../../../../../apps/example-static/", import.meta.url));
const temporary = await mkdtemp(resolve(tmpdir(), "renkin-command-probe-"));
try {
  const external = withBuildCommand(site, {
    cwd: root,
    command: [
      process.execPath,
      "x",
      "moon",
      "run",
      "example-static:build",
      "--no-actions",
      "--force",
      "--cache",
      "off",
    ],
    manifest: ".renkin/build-result.json",
    environment: {
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      PROTO_OFFLINE: "true",
      WRANGLER_LOG_PATH: resolve(temporary, "wrangler.log"),
      WRANGLER_REGISTRY_PATH: resolve(temporary, "registry"),
      MINIFLARE_REGISTRY_PATH: resolve(temporary, "miniflare"),
    },
  });
  const first = await buildAstro(external);
  const second = await buildAstro(external);
  assert.deepEqual(first, second);
  const source = await readFile(first.entry, "utf8");
  assert.ok(source.includes("__renkinRequirements"));
  assert.ok(!source.includes('import server from "./renkin-entry-'));
  assert.deepEqual(external.dependencies, site.dependencies);
  await rm(resolve(root, ".renkin/build-result.json"));
  const restored = await buildAstro(external);
  assert.equal(await readFile(restored.entry, "utf8"), source);
  assert.ok(JSON.parse(await readFile(resolve(root, ".renkin/build-result.json"), "utf8")).entry);
  console.log("Public Moon → Astro CLI nesting and verified reuse passed.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
