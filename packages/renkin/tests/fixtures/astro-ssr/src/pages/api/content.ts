import { env } from "cloudflare:workers";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { APIRoute } from "astro";
export const GET: APIRoute = async () =>
  Response.json({
    message: (await (env.CONTENT as KVNamespace).get("welcome")) ?? "Native KV is connected.",
  });
