import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import { Effect } from "effect";
import { boundRequests } from "../../support/root/cloud-full-graph/bounded-fetch.ts";

it("bounded cloud requests preserve SDK pagination auth when fetch receives Request as init", async () => {
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, errors: [], messages: [], result: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const restore = boundRequests();
  try {
    const client = createBackgroundClient(
      {
        accountId: "account",
        apiToken: "test-token",
        apiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      },
      { request: () => Promise.reject(new Error("Read-only test.")) },
    );
    expect(await Effect.runPromise(client.listQueues(1))).toEqual({ result: [] });
    expect(authorization).toBe("Bearer test-token");
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
