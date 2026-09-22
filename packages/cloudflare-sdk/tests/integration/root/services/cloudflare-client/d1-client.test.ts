import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { GatewayRequest } from "#src/contexts/root/services/cloudflare-client/cloudflare-client.ts";
import { createD1Client } from "#src/contexts/root/services/cloudflare-client/d1-client.ts";

const fixture = (result: unknown, status = 200) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      let calls = 0;
      let dispatched: GatewayRequest | undefined;
      const server = createServer((_req, res) => {
        calls++;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            status === 429
              ? { success: false, errors: [{ code: 1015, message: "rate limited" }] }
              : { success: true, result, errors: [] },
          ),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = createD1Client(
        { accountId: "account", apiToken: "test-token", apiBaseUrl: url },
        {
          request: async (request, token) => {
            expect(token).toBe("lease");
            expect(request.headers?.authorization).toBeUndefined();
            dispatched = request;
            const response = await fetch(`${url}${request.path}`, {
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
      return { client, server, calls: () => calls, dispatched: () => dispatched };
    }),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

it.effect("detects a failed statement inside an HTTP200 success envelope", () =>
  Effect.gen(function* () {
    const test = yield* fixture([
      { success: true, results: [] },
      { success: false, error: "private SQL" },
    ]);
    const error = yield* test.client
      .query({ databaseId: "db", sql: "INSERT INTO x VALUES ('private SQL'); SELECT 1;" }, "lease")
      .pipe(Effect.flip);
    expect(error._tag).toBe("D1StatementError");
    if (error._tag === "D1StatementError") expect(error.statement).toBe(1);
    expect(String(error)).not.toContain("private SQL");
    expect(test.calls()).toBe(1);
  }),
);

it.effect("preserves SQL and result ordering through real Distilled serialization", () =>
  Effect.gen(function* () {
    const test = yield* fixture([
      { success: true, results: [{ value: 1 }] },
      { success: true, results: [{ value: 2 }] },
    ]);
    const sql = "SELECT 1;\r\nSELECT 2;";
    const result = yield* test.client.query({ databaseId: "db", sql }, "lease");
    expect(result.result.map((row) => row.results)).toEqual([[{ value: 1 }], [{ value: 2 }]]);
    expect(test.dispatched()?.path).toBe("/accounts/account/d1/database/db/query");
    expect(
      JSON.parse(Buffer.from(test.dispatched()?.bodyBase64 ?? "", "base64").toString()),
    ).toEqual({ sql });
  }),
);

it.effect("does not retry SQL mutations after throttling", () =>
  Effect.gen(function* () {
    const test = yield* fixture(null, 429);
    const error = yield* test.client
      .raw({ databaseId: "db", sql: "INSERT INTO x VALUES (1)" }, "lease")
      .pipe(Effect.flip);
    expect(error._tag).toBe("TooManyRequests");
    expect(test.calls()).toBe(1);
  }),
);
