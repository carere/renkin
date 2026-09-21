import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import {
  createCloudflareClient,
  type MutationGateway,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { cloudflareWorkerService } from "#src/contexts/root/services/worker/cloudflare-worker-service.ts";

const fixture = (rejectClosure: boolean) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: { method: string; path: string; body: string }[] = [];
      const replies = [
        { tags: ["renkin:stack:cloud:site"] },
        { enabled: true, previews_enabled: true },
        { enabled: false, previews_enabled: false },
        {},
        { enabled: false, previews_enabled: false },
      ];
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        requests.push({
          method: request.method ?? "GET",
          path: request.url ?? "",
          body: Buffer.concat(chunks).toString(),
        });
        const rejected = rejectClosure && requests.length === 3;
        response.writeHead(rejected ? 403 : 200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            rejected
              ? {
                  success: false,
                  errors: [{ code: 10000, message: "Test rejects origin closure" }],
                }
              : { success: true, result: replies[requests.length - 1] },
          ),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
      const gateway: MutationGateway = {
        request: async (request) => {
          const response = await fetch(`${base}${request.path}`, {
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
      };
      const config = { accountId: "account", apiToken: "test", apiBaseUrl: base };
      return {
        server,
        requests,
        service: cloudflareWorkerService({
          client: createCloudflareClient(config, gateway),
          siteClient: createSiteClient(config, gateway),
          token: "lease",
          stack: "stack",
          environment: "cloud",
          subdomain: "account",
        }),
      };
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
const resource: ResourceState = {
  definition: {
    id: "site",
    type: "cloudflare.worker",
    identity: "site",
    properties: {
      source: "export default {fetch:()=>new Response('private-application')}",
      compatibilityDate: "2026-07-30",
      compatibilityFlags: [],
      workersDev: false,
    },
  },
  physicalId: "worker-id",
  outputs: {},
};
for (const rejectClosure of [false, true]) {
  it.live(
    rejectClosure
      ? "does not publish private source when alternate-origin closure fails"
      : "closes an existing public origin before uploading private application source",
    () =>
      Effect.gen(function* () {
        const { service, requests } = yield* fixture(rejectClosure);
        const outcome = yield* Effect.tryPromise(
          () => service.bind?.(resource, { site: resource }) ?? Promise.resolve(),
        ).pipe(Effect.exit);
        expect(outcome._tag).toBe(rejectClosure ? "Failure" : "Success");
        expect(requests.slice(0, 3).map((request) => request.method)).toEqual([
          "GET",
          "GET",
          "POST",
        ]);
        expect(requests[2]?.path).toContain("/subdomain");
        expect(JSON.parse(requests[2]?.body ?? "{}")).toEqual({
          enabled: false,
          previews_enabled: false,
        });
        const uploads = requests.filter((request) => request.method === "PUT");
        expect(uploads).toHaveLength(rejectClosure ? 0 : 1);
        if (!rejectClosure) expect(requests[3]?.body).toContain("private-application");
      }).pipe(Effect.scoped),
  );
}
