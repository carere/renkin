import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Requirements } from "@renkin/runtime/models/binding";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { WorkerDevelopmentConnection } from "@renkin/runtime/models/worker-builder";
import { NodeRequest, sendNodeResponse } from "srvx/node";
import type { Plugin } from "vite";
import { platformModuleSource, websiteRequestContext } from "./request-context.ts";

const originHeader = "x-renkin-development-origin";
const tokenHeader = "x-renkin-development-token";
const virtualModule = "\0renkin:development-platform";

export const createPlatformBridge = () => {
  const token = randomUUID();
  let connection: WorkerDevelopmentConnection | undefined;
  const pending = new Set<Promise<void>>();
  const plugin: Plugin = {
    name: "renkin:development-platform",
    enforce: "pre",
    resolveId(id) {
      if (id !== "cloudflare:workers") return;
      if (this.environment.name === "client")
        throw new Error("Cloudflare bindings cannot be imported into browser code.");
      return virtualModule;
    },
    load: (id) => (id === virtualModule ? platformModuleSource : undefined),
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!connection) return next();
        if (req.headers[tokenHeader] === token && typeof req.headers[originHeader] === "string") {
          const original = new URL(req.headers[originHeader]);
          req.headers.host = original.host;
          req.url = original.pathname + original.search;
        }
        delete req.headers[tokenHeader];
        delete req.headers[originHeader];
        try {
          if (req.url?.startsWith("/cdn-cgi/local/r2/s3/")) {
            await sendNodeResponse(res, await connection.dispatch(new NodeRequest({ req, res })));
            return;
          }
          const context = {
            bindings: await connection.bindings(),
            pending: new Set<Promise<unknown>>(),
            active: true,
          };
          res.once("close", () => {
            const completion = Promise.resolve().then(async () => {
              while (context.pending.size) {
                const batch = [...context.pending];
                context.pending.clear();
                await Promise.allSettled(batch);
              }
              context.active = false;
              pending.delete(completion);
            });
            pending.add(completion);
          });
          websiteRequestContext.run(context, next);
        } catch (error) {
          next(error);
        }
      });
    },
  };
  return {
    plugin,
    connect: async (value: WorkerDevelopmentConnection) => {
      connection = value;
    },
    close: async () => {
      connection = undefined;
      await Promise.allSettled(pending);
    },
    forwardingBuild: async (
      directory: string,
      url: string,
      requirements: Requirements,
    ): Promise<WorkerBuildResult> => {
      await mkdir(directory, { recursive: true });
      const entry = resolve(directory, "development-worker.mjs");
      await writeFile(
        entry,
        `export default {
__renkinRequirements:${JSON.stringify(requirements)},
fetch(request){
 const url=new URL(request.url);const origin=url.href;
 const target=new URL(${JSON.stringify(url)});url.host=target.host;url.protocol=target.protocol;
 const forwarded=new Request(url,request);
 forwarded.headers.set(${JSON.stringify(originHeader)},origin);
 forwarded.headers.set(${JSON.stringify(tokenHeader)},${JSON.stringify(token)});
 return fetch(forwarded);
}};\n`,
      );
      return { entry };
    },
  };
};
