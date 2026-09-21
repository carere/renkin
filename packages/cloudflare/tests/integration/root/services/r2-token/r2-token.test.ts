import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { createAccountTokenClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/account-token-client";
import type { GatewayRequest } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { r2 } from "../../../../../src/contexts/root/models/r2.ts";
import { r2Token } from "../../../../../src/contexts/root/models/r2-token.ts";
import { cloudflareR2TokenService } from "../../../../../src/contexts/root/services/r2-token/cloudflare-r2-token-service.ts";

const fixture = (existing = false, failed = false) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const writes: GatewayRequest[] = [];
      const token = { id: "provider-id", name: "allocation" };
      const server = createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://local").pathname;
        let result: unknown = {};
        if (path.endsWith("permission_groups"))
          result = ["Read", "Write"].map((operation) => ({
            id: operation,
            name: `Workers R2 Storage Bucket Item ${operation}`,
            scopes: ["com.cloudflare.edge.r2.bucket"],
          }));
        else if (request.method === "GET") result = existing ? [token] : [];
        else if (request.method === "POST") result = { ...token, value: "one-time-value" };
        response.writeHead(failed && request.method === "POST" ? 429 : 200, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify(
            failed && request.method === "POST"
              ? { success: false, errors: [{ code: 1015, message: "limited" }] }
              : { success: true, result, result_info: { page: 1, total_pages: 1 } },
          ),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = createAccountTokenClient(
        { accountId: "account", apiToken: "explicit-management", apiBaseUrl: base },
        {
          request: async (request, lease) => {
            expect(lease).toBe("lease");
            expect(request.headers?.authorization).toBeUndefined();
            writes.push(request);
            if (request.receiptOnly)
              return {
                status: 200,
                headers: { "content-type": "application/json" },
                bodyBase64: Buffer.from(JSON.stringify({ success: true, result: {} })).toString(
                  "base64",
                ),
              };
            const response = await fetch(base + request.path, {
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
      return { server, writes, service: cloudflareR2TokenService(client, "account", "lease") };
    }),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
const bucket: ResourceState = {
  definition: r2("Files"),
  physicalId: "owned-physical-bucket",
  outputs: {},
  ownershipId: "Files",
};
const definition = r2Token("Uploads", {
  buckets: [r2("Files")],
  permissions: "read-write",
  expiresAt: "2099-01-01T00:00:00Z",
  allowDelete: true,
});
it.effect(
  "serializes exact owned R2 scopes and recovers credentials through the real account SDK",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const outputs = yield* Effect.promise(() =>
        test.service.apply(definition, "allocation", undefined, { Files: bucket }),
      );
      expect(outputs).toMatchObject({
        accessKeyId: "provider-id",
        secretAccessKey: createHash("sha256").update("one-time-value").digest("hex"),
        buckets: { Files: "owned-physical-bucket" },
        endpoint: "https://account.r2.cloudflarestorage.com",
      });
      expect(test.writes.map((item) => item.receiptOnly === true)).toEqual([true, false]);
      expect(test.writes[1]?.operationKey).toBe("account-token-create:allocation");
      expect(
        JSON.parse(Buffer.from(test.writes[1]?.bodyBase64 ?? "", "base64").toString()),
      ).toEqual({
        name: "allocation",
        expires_on: "2099-01-01T00:00:00Z",
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: "Read" }, { id: "Write" }],
            resources: {
              "com.cloudflare.edge.r2.bucket.account_default_owned-physical-bucket": "*",
            },
          },
        ],
      });
    }),
);
it.effect(
  "does not recreate an already allocated token when its one-time response is unavailable",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture(true);
      yield* Effect.promise(async () =>
        expect(
          test.service.apply(definition, "allocation", undefined, { Files: bucket }),
        ).rejects.toThrow("one-time secret is unavailable"),
      );
      expect(test.writes).toHaveLength(1);
      expect(test.writes[0]?.receiptOnly).toBe(true);
    }),
);
it.effect("does not retry a non-idempotent account token creation", () =>
  Effect.gen(function* () {
    const test = yield* fixture(false, true);
    yield* Effect.promise(async () =>
      expect(
        test.service.apply(definition, "allocation", undefined, { Files: bucket }),
      ).rejects.toThrow(),
    );
    expect(test.writes.filter((item) => !item.receiptOnly)).toHaveLength(1);
  }),
);
it.effect("revokes only the recorded account token and refuses ownership mismatch", () =>
  Effect.gen(function* () {
    const test = yield* fixture(true);
    const resource: ResourceState = {
      definition,
      physicalId: "provider-id",
      outputs: { id: "provider-id", name: "different-name" },
    };
    yield* Effect.promise(async () =>
      expect(test.service.remove(resource)).rejects.toThrow("ownership differs"),
    );
    expect(test.writes).toHaveLength(0);
    yield* Effect.promise(() =>
      test.service.remove({
        ...resource,
        outputs: { id: "provider-id", name: "allocation" },
      }),
    );
    expect(test.writes[0]?.path).toBe("/accounts/account/tokens/provider-id");
    expect(test.writes[0]?.method).toBe("DELETE");
  }),
);
