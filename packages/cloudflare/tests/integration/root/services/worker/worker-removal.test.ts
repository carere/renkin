import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import {
  createCloudflareClient,
  type GatewayRequest,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { ResourceState } from "@renkin/core/models/state";
import { canonical } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
import { cloudflareWorkerService } from "../../../../../src/contexts/root/services/worker/cloudflare-worker-service.ts";

const caller: ResourceState = {
  definition: {
    id: "a",
    type: "cloudflare.worker",
    identity: "worker",
    properties: {
      source: "export default {fetch(){return new Response('owned')}}",
      compatibilityDate: "2026-08-01",
      compatibilityFlags: [],
      requirements: { B: { type: "cloudflare.worker-reference", id: "b" } },
    },
  },
  physicalId: "owned-a",
  outputs: null,
};
const target: ResourceState = {
  definition: {
    ...caller.definition,
    id: "b",
    properties: { ...(caller.definition.properties as object), requirements: {} },
  },
  physicalId: "owned-b",
  outputs: null,
};
const resolved = [{ type: "service", name: "B", service: "owned-b" }];
const config = createHash("sha256")
  .update(canonical(caller.definition.properties))
  .update(JSON.stringify(resolved))
  .digest("hex");
const settings = (attached: boolean, tag = `renkin-config:${config}`) => ({
  tags: ["renkin:app:dev:owned-a", tag],
  bindings: attached ? resolved : [],
});

const fixture = async (observations: unknown[], blocked = true) => {
  const requests: { method: string; path: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      method: request.method ?? "GET",
      path: request.url ?? "",
      body: Buffer.concat(chunks).toString(),
    });
    const failure = request.method === "DELETE" && blocked;
    if (request.method === "DELETE") blocked = false;
    const result = request.method === "GET" ? observations.shift() : { id: "owned-a" };
    response.writeHead(failure ? 409 : 200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        success: !failure,
        errors: failure ? [{ code: 10000, message: "Still referenced by another owner" }] : [],
        messages: [],
        result,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const gateway = {
    request: async (request: GatewayRequest, token: string) => {
      expect(token).toBe("fence");
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
  };
  const credentials = { accountId: "account", apiToken: "test", apiBaseUrl: origin };
  return {
    requests,
    service: cloudflareWorkerService({
      client: createCloudflareClient(credentials, gateway),
      siteClient: createSiteClient(credentials, gateway),
      token: "fence",
      stack: "app",
      environment: "dev",
      subdomain: "test",
    }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};
const targetSettings = { tags: ["renkin:app:dev:owned-b"], bindings: [] };

it.effect(
  "recovers after detaching owned callers without repeating the upload or forcing a foreign binding",
  () =>
    Effect.promise(async () => {
      const test = await fixture([
        targetSettings,
        settings(true),
        targetSettings,
        targetSettings,
        settings(false),
        targetSettings,
      ]);
      try {
        await expect(test.service.remove(target, { a: caller, b: target })).rejects.toThrow();
        await test.service.remove(target, { a: caller, b: target });
        const writes = test.requests.filter((request) => request.method !== "GET");
        expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
          "PUT /accounts/account/workers/scripts/owned-a",
          "DELETE /accounts/account/workers/scripts/owned-b",
          "DELETE /accounts/account/workers/scripts/owned-b",
        ]);
        expect(writes[0]?.body).toContain('"bindings":[]');
        expect(writes.every((request) => !request.path.includes("force"))).toBe(true);
      } finally {
        await test.close();
      }
    }),
);

it.effect(
  "refuses to overwrite a caller whose recorded configuration or ownership no longer matches",
  () =>
    Effect.promise(async () => {
      for (const observed of [
        settings(true, "renkin-config:changed"),
        { tags: ["another-owner"], bindings: resolved },
      ]) {
        const test = await fixture([targetSettings, observed]);
        try {
          await expect(test.service.remove(target, { a: caller, b: target })).rejects.toThrow();
          expect(test.requests.every((request) => request.method === "GET")).toBe(true);
        } finally {
          await test.close();
        }
      }
    }),
);
