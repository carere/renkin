import { createServerFn } from "@tanstack/solid-start";
export const readCount = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("cloudflare:workers");
  return { value: Number((await env.DATA.get("counter")) ?? "0"), stage: env.STAGE };
});
