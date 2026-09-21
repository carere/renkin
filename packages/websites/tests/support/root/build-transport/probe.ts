import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeCloudflareTransport } from "#src/contexts/root/services/build-transport/cloudflare-transport.ts";

const plugin = createRequire(import.meta.url).resolve("@cloudflare/vite-plugin/package.json");
const path = createRequire(plugin).resolve("miniflare");
const require = createRequire(path);
const real = require("undici/index.js");
const native = require("undici");
const nativeFetch = native.fetch;
const globalFetch = globalThis.fetch;
const actualFetch = real.fetch;
let dispatches = 0;
real.fetch = (input: unknown, options: { dispatcher?: unknown }) => {
  assert.ok(options.dispatcher);
  dispatches++;
  return actualFetch(input, options);
};
if (!process.argv.includes("--native-control")) {
  initializeCloudflareTransport();
  initializeCloudflareTransport();
}
const first = await import(path);
assert.equal(await import(path), first);
const runtime = new first.Miniflare(
  first.convertV4MiniflareOptions({
    name: "transport-probe",
    modules: true,
    script:
      "export default {fetch(request){return Response.json({host:new URL(request.url).host,runtime:typeof WebSocketPair})}}",
    compatibilityDate: "2026-07-30",
  }),
);
try {
  for (let i = 0; i < 3; i++) {
    const response = await runtime.dispatchFetch("http://original.example/");
    assert.equal(response.status, 200);
    assert.ok(dispatches > 0, "Miniflare did not invoke the actual undici dispatcher.");
    assert.deepEqual(await response.json(), { host: "original.example", runtime: "function" });
  }
  assert.ok(dispatches >= 3);
  assert.equal(native.fetch, nativeFetch);
  assert.equal(globalThis.fetch, globalFetch);
  console.log("real dispatcher, original URL, workerd and import identity verified");
} finally {
  await runtime.dispose();
  real.fetch = actualFetch;
}
