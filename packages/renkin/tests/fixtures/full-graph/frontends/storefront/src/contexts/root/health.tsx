import { createServerFn } from "@tanstack/solid-start";
export const health = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("cloudflare:workers");
  return (
    await (env.API as { fetch(request: Request): Promise<Response> }).fetch(
      new Request("https://api/health"),
    )
  ).text();
});
