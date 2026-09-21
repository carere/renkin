import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { GatewayRequest } from "#src/contexts/root/services/cloudflare-client/cloudflare-client.ts";
import { createR2Client } from "#src/contexts/root/services/cloudflare-client/r2-client.ts";

const fixture = (status = 200) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dispatched: GatewayRequest[] = [];
      const server = createServer((request, response) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            status === 429
              ? { success: false, errors: [{ code: 1015, message: "limited" }] }
              : {
                  success: true,
                  result:
                    request.method === "POST"
                      ? {
                          name: "owned",
                          creation_date: "2026-09-21T00:00:00Z",
                          storage_class: "Standard",
                        }
                      : {},
                  errors: [],
                },
          ),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = createR2Client(
        { accountId: "account", apiToken: "test-token", apiBaseUrl: url },
        {
          request: async (request, token) => {
            expect(token).toBe("lease");
            expect(request.headers?.authorization).toBeUndefined();
            dispatched.push(request);
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
      return { client, dispatched, server };
    }),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

it.effect(
  "serializes R2 creation, jurisdiction and CORS through the actual SDK and fenced transport",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const created = yield* test.client.create({ name: "owned", jurisdiction: "eu" }, "lease");
      expect(created.name).toBe("owned");
      expect(test.dispatched[0]?.headers?.["cf-r2-jurisdiction"]).toBe("eu");
      const rules = [
        {
          allowed: {
            origins: ["https://app.example"],
            methods: ["GET", "PUT", "HEAD"],
            headers: ["content-type"],
          },
          exposeHeaders: ["etag"],
          maxAgeSeconds: 120,
        },
      ];
      yield* test.client.setCors({ bucketName: "owned", jurisdiction: "eu", rules }, "lease");
      expect(
        JSON.parse(Buffer.from(test.dispatched[1]?.bodyBase64 ?? "", "base64").toString()),
      ).toEqual({ rules });
      expect(test.dispatched[1]?.path).toBe("/accounts/account/r2/buckets/owned/cors");
    }),
);

it.effect(
  "preserves literal slashes and encoded percent characters when deleting an exact object",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      yield* test.client.removeObject("owned", "folder/a %2F café", "default", "lease");
      expect(test.dispatched[0]?.path).toBe(
        "/accounts/account/r2/buckets/owned/objects/folder/a%20%252F%20caf%C3%A9",
      );
    }),
);

it.effect("does not retry a failed bucket mutation", () =>
  Effect.gen(function* () {
    const test = yield* fixture(429);
    yield* test.client.create({ name: "owned" }, "lease").pipe(Effect.flip);
    expect(test.dispatched).toHaveLength(1);
  }),
);

it.effect("refuses dot-segment object paths before they can normalize to another object", () =>
  Effect.gen(function* () {
    const test = yield* fixture();
    const error = yield* test.client
      .removeObject("owned", "folder/../other", "default", "lease")
      .pipe(Effect.flip);
    expect(error._tag).toBe("R2ObjectKeyError");
    expect(test.dispatched).toHaveLength(0);
  }),
);
