import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
export const GET: APIRoute = async () =>
  Response.json({ message: (await env.CONTENT.get("welcome")) ?? "Native KV is connected." });
