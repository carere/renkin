import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
export const Route = createFileRoute("/api/counter")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ value: Number((await env.DATA.get("counter")) ?? "0"), stage: env.STAGE }),
      POST: async () => {
        const value = Number((await env.DATA.get("counter")) ?? "0") + 1;
        await env.DATA.put("counter", String(value));
        return Response.json({ value });
      },
    },
  },
});
