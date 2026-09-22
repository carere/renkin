import type { Miniflare } from "miniflare";
import { localR2GatewayName } from "./local-r2-service.ts";

/** Dispatch directly so reverse proxies need not rewrite signed origins or trust headers. */
export const graphDispatcher =
  (runtime: Miniflare, workers: ReadonlySet<string>, r2: boolean) =>
  async (id: string, request: Request): Promise<Response> => {
    if (!workers.has(id)) throw new Error("Worker is not declared in the graph.");
    const target = await runtime.getWorker(r2 ? localR2GatewayName(id) : id);
    const response = await target.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.body as never,
      duplex: "half",
      redirect: "manual",
    });
    return new Response(response.body as unknown as ReadableStream, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
    });
  };
