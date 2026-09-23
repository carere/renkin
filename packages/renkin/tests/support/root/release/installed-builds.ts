import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tanstackStart } from "@carere/renkin/cloudflare";
import { buildTanStack } from "@carere/renkin/vite";

// This file runs only after being copied into the standalone consumer root.
const { site } = (await import(
  new URL("./apps/example-spa/resources.ts", import.meta.url).href
)) as {
  site: ReturnType<typeof tanstackStart>;
};
let compilations = 0;
const captured = tanstackStart("InstalledReuse", {
  ...site.website,
  beforeBuild: () => {
    compilations++;
  },
  reuse: { key: "installed-release-v1", values: { hook: "compile-counter" } },
});
const first = await buildTanStack(captured);
const source = await readFile(first.entry, "utf8");
assert.deepEqual(await buildTanStack(captured), first);
assert.equal(compilations, 1);
const map = first.auxiliaryFiles?.find((file) => file.endsWith(".map"));
assert.ok(map, "Source maps must be captured as auxiliary files");
await rm(resolve(dirname(first.entry), map));
const repaired = await buildTanStack(captured);
assert.equal(compilations, 2, "Missing captured source map must invalidate reuse");
assert.ok(await readFile(resolve(dirname(repaired.entry), map), "utf8"));
assert.equal(await readFile(first.entry, "utf8"), source);
console.info("Installed build snapshot reuse and source-map invalidation passed.");
