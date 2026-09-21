import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { NodeRequest, sendNodeResponse } from "srvx/node";
import { createServer, isRunnableDevEnvironment } from "vite";
import { createPlatformBridge } from "../../../../src/contexts/root/services/development/platform-bridge.ts";

const nativeServer = async (
  directory: string,
  entry: string,
  bridge: ReturnType<typeof createPlatformBridge>,
) => {
  return createServer({
    configFile: false,
    root: directory,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      bridge.plugin,
      {
        name: "test-native-handler",
        configureServer(server) {
          return () =>
            server.middlewares.use(async (req, res, next) => {
              try {
                const environment = server.environments.ssr;
                if (!environment || !isRunnableDevEnvironment(environment))
                  throw Error("Missing runner");
                const module = await environment.runner.import(entry);
                req.url = req.originalUrl ?? req.url;
                await sendNodeResponse(
                  res,
                  await module.default.fetch(new NodeRequest({ req, res })),
                );
              } catch (error) {
                next(error);
              }
            });
        },
      },
    ],
  });
};

it("bridges native storage and isolates request bindings on Vite's actual SSR runner", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "renkin-platform-"));
  const bridge = createPlatformBridge();
  const entry = resolve(directory, "app.mjs");
  await writeFile(
    entry,
    `import {env,waitUntil} from 'cloudflare:workers';
export const outside=()=>env.DATA;
export default {async fetch(request){
 const url=new URL(request.url);const id=env.REQUEST_ID;
 await new Promise(resolve=>setTimeout(resolve,10));
 if(id!==env.REQUEST_ID)throw Error('request binding leaked');
 await env.DATA.put(url.pathname,String(id));
 waitUntil(env.DATA.put('background-'+id,'finished'));
 return Response.json({id,stored:await env.DATA.get(url.pathname),url:request.url});
}};`,
  );
  const server = await nativeServer(directory, entry, bridge);
  let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("No Vite address");
    const url = `http://127.0.0.1:${address.port}`;
    const build = await bridge.forwardingBuild(resolve(directory, "worker"), url, {
      DATA: { type: "cloudflare.kv", id: "data" },
    });
    graph = await startLocalGraph({
      workers: [{ id: "site", build, compatibilityDate: "2026-07-30" }],
      namespaces: { data: "native-data" },
      persist: resolve(directory, "persist"),
    });
    let requestId = 0;
    const current = graph;
    await bridge.connect({
      bindings: async () => ({
        ...(await current.bindings("site")),
        REQUEST_ID: String(++requestId),
      }),
      dispatch: (request) => current.dispatch("site", request),
    });
    const values = await Promise.all(
      ["one", "two"].map(async (path) => {
        const response = await fetch(`${url}/${path}`);
        expect(response.status).toBe(200);
        return response.json() as Promise<{ id: string; stored: string; url: string }>;
      }),
    );
    expect(new Set(values.map((value) => value.id)).size).toBe(2);
    for (const value of values) expect(value.stored).toBe(value.id);
    const site = graph.workers.site;
    if (!site) throw Error("Missing site");
    const forwarded = (await (await site.fetch("/graph")).json()) as { url: string };
    expect(forwarded.url).toBe(new URL("/graph", site.url).href);
    const environment = server.environments.ssr;
    if (!environment || !isRunnableDevEnvironment(environment)) throw Error("Missing runner");
    expect((await environment.runner.import(entry)).outside).toThrow("active request");
  } finally {
    await server.close();
    await bridge.close();
    await graph?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
