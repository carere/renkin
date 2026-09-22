import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeCloudflareTransport } from "#src/contexts/root/services/build-transport/cloudflare-transport.ts";

const plugin = createRequire(import.meta.url).resolve("@cloudflare/vite-plugin/package.json");
const require = createRequire(plugin);
const path = require.resolve("miniflare");
initializeCloudflareTransport();
initializeCloudflareTransport();
// The official Vite plugin imports Miniflare as ESM while Wrangler requires it as CJS.
// A partially initialized Bun object-loader module must not leak into either consumer.
const modules = [path, require.resolve("wrangler")] as const;
const [miniflare] = process.argv.includes("--serial")
  ? [await import(modules[0]), await import(modules[1])]
  : await Promise.all(modules.map((module) => import(module)));
assert.equal(typeof miniflare.Mutex, "function");
assert.equal(require("miniflare").Mutex, miniflare.Mutex);
assert.equal(require("miniflare").Miniflare, miniflare.Miniflare);
assert.ok(new miniflare.Mutex());
console.log("Wrangler CJS and Miniflare ESM share initialized exports");
