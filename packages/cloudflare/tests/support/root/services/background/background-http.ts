import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";

/** Predetermined provider observations exercise the real SDK wire boundary. */
export const backgroundHttp = async (observations: readonly unknown[]) => {
  const calls: { method: string; path: string; body: string }[] = [];
  let index = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls.push({
      method: request.method ?? "GET",
      path: request.url ?? "",
      body: Buffer.concat(chunks).toString(),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ success: true, errors: [], messages: [], result: observations[index++] }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createBackgroundClient(
    { accountId: "account", apiToken: "test", apiBaseUrl: origin },
    {
      request: async (request, token) => {
        if (token !== "lease") throw new Error("Missing fence token");
        const response = await fetch(`${origin}${request.path}`, {
          method: request.method,
          headers: request.headers ?? {},
          ...(request.bodyBase64 ? { body: Buffer.from(request.bodyBase64, "base64") } : {}),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
        };
      },
    },
  );
  return {
    client,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
