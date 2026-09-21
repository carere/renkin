import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { r2TokenClient } from "@renkin/runtime/models/r2-token";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { AwsClient } from "aws4fetch";
import { createServer } from "vite";
import { createPlatformBridge } from "#src/contexts/root/services/development/platform-bridge.ts";

it("preserves the frontend origin for signed R2 requests before SPA fallback", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "renkin-vite-r2-"));
  const bridge = createPlatformBridge();
  const credentials = { accessKeyId: "local-vite-key", secretAccessKey: "local-vite-secret" };
  await writeFile(resolve(directory, "index.html"), "<!doctype html><h1>SPA fallback</h1>");
  const server = await createServer({
    configFile: false,
    root: directory,
    plugins: [bridge.plugin],
    server: { host: "127.0.0.1", port: 0 },
  });
  let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("No Vite listener");
    const url = `http://127.0.0.1:${address.port}`;
    const build = await bridge.forwardingBuild(resolve(directory, "worker"), url, {
      FILES: { type: "cloudflare.r2", id: "Files" },
      TOKEN: { type: "cloudflare.r2-token", id: "Token" },
    });
    graph = await startLocalGraph({
      workers: [{ id: "site", build, compatibilityDate: "2026-07-30" }],
      namespaces: {},
      buckets: { Files: "native-vite-files" },
      r2Tokens: { Token: ["Files"] },
      r2S3: credentials,
      persist: resolve(directory, "data"),
    });
    const current = graph;
    await bridge.connect({
      bindings: () => current.bindings("site"),
      dispatch: (request) => current.dispatch("site", request),
    });
    const config = r2TokenClient((await graph.bindings("site")).TOKEN).forRequest(new Request(url));
    expect(config.endpoint).toBe(`${url}/cdn-cgi/local/r2/s3/`);
    const signer = new AwsClient({ ...config, service: "s3" });
    const target = `${config.endpoint}Files/nested/object.txt`;
    const put = await signer.sign(target, {
      method: "PUT",
      body: "shared native bytes",
      aws: { signQuery: true },
    });
    expect((await fetch(put)).status).toBe(200);
    expect(await (await (await graph.bucket("Files")).get("nested/object.txt"))?.text()).toBe(
      "shared native bytes",
    );
    expect(
      await (await fetch(await signer.sign(target, { aws: { signQuery: true } }))).text(),
    ).toBe("shared native bytes");
    const invalid = await signer.sign(`${target}?unused=x`, { aws: { signQuery: true } });
    expect((await fetch(`${invalid.url}&tampered=true`)).status).toBe(403);
    expect(await (await fetch(`${url}/unknown-route`)).text()).toContain("SPA fallback");
  } finally {
    await server.close();
    await bridge.close();
    await graph?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
