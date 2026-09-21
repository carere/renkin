import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  createCloudflareClient,
  type MutationGateway,
} from "../../../../../src/contexts/root/services/cloudflare-client/cloudflare-client.ts";

const serve = (status: number, code: number) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: { url: string | undefined; authorization: string | undefined }[] = [];
      const server = createServer((request, response) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: false,
            errors: [{ code, message: "provider failure" }],
            messages: [],
            result: null,
          }),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const apiBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
      return { server, requests, apiBaseUrl };
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );

const forbiddenGateway: MutationGateway = {
  request: async () => {
    throw new Error("unexpected mutation");
  },
};

describe("Distilled HTTP boundary", () => {
  for (const [status, code, tag, count] of [
    [404, 10007, "WorkerNotFound", 1],
    [403, 10000, "Unauthorized", 1],
    [404, 7003, "InvalidRoute", 1],
    [400, 987654, "BadRequest", 1],
    [429, 1015, "TooManyRequests", 3],
  ] as const) {
    it.live(`preserves ${tag} and makes ${count} requests`, () =>
      Effect.gen(function* () {
        const server = yield* serve(status, code);
        const client = createCloudflareClient(
          { accountId: "account", apiToken: "test-token", apiBaseUrl: server.apiBaseUrl },
          forbiddenGateway,
        );
        const error = yield* client.getWorker("worker").pipe(Effect.flip);
        expect(error._tag).toBe(tag);
        expect(server.requests).toHaveLength(count);
        expect(server.requests[0]).toEqual({
          url: "/client/v4/accounts/account/workers/scripts/worker/settings",
          authorization: "Bearer test-token",
        });
      }).pipe(Effect.scoped),
    );
  }
});

describe("fenced mutations", () => {
  it.effect("serializes multipart uploads through the fenced gateway without credentials", () =>
    Effect.gen(function* () {
      let observedToken: string | undefined;
      let observedRequest: Request | undefined;
      const gateway: MutationGateway = {
        request: async (request, token) => {
          observedToken = token;
          observedRequest = new Request(`https://api.cloudflare.com${request.path}`, {
            method: request.method,
            headers: request.headers ?? {},
            body: Buffer.from(request.bodyBase64 ?? "", "base64"),
          });
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            bodyBase64: Buffer.from(
              JSON.stringify({ success: true, errors: [], messages: [], result: { id: "worker" } }),
            ).toString("base64"),
          };
        },
      };
      const client = createCloudflareClient({ accountId: "account", apiToken: "secret" }, gateway);
      yield* client.putWorker(
        {
          scriptName: "worker",
          metadata: { mainModule: "index.js", compatibilityDate: "2026-09-21" },
          files: new File(["export default {}"], "index.js", {
            type: "application/javascript+module",
          }),
        },
        "fence-token",
      );
      expect(observedToken).toBe("fence-token");
      expect(observedRequest?.url).toBe(
        "https://api.cloudflare.com/accounts/account/workers/scripts/worker",
      );
      expect(observedRequest?.headers.has("authorization")).toBe(false);
      const form = yield* Effect.promise(() => {
        if (!observedRequest) throw new Error("missing gateway request");
        return observedRequest.formData();
      });
      expect(JSON.parse(String(form.get("metadata")))).toMatchObject({
        main_module: "index.js",
        compatibility_date: "2026-09-21",
      });
      const module = form.get("index.js");
      expect(module).toBeInstanceOf(File);
      expect(yield* Effect.promise(() => (module as File).text())).toBe("export default {}");
    }),
  );
});

describe("mutation retry policy", () => {
  it.effect("does not retry rejected mutations", () =>
    Effect.gen(function* () {
      let calls = 0;
      const client = createCloudflareClient(
        { accountId: "account", apiToken: "secret" },
        {
          request: async () => {
            calls++;
            return {
              status: 429,
              headers: { "content-type": "application/json" },
              bodyBase64: Buffer.from(
                JSON.stringify({
                  success: false,
                  errors: [{ code: 1015, message: "throttled" }],
                  result: null,
                }),
              ).toString("base64"),
            };
          },
        },
      );
      const error = yield* client.deleteWorker("worker", "fence-token").pipe(Effect.flip);
      expect(error._tag).toBe("TooManyRequests");
      expect(calls).toBe(1);
    }),
  );
});
