import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import type { MutationGateway } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import { Effect } from "effect";
import { customDomain } from "../../../../../src/contexts/root/models/site.ts";
import { worker } from "../../../../../src/contexts/root/models/worker.ts";
import { cloudflareSiteServices } from "../../../../../src/contexts/root/services/site/cloudflare-site-service.ts";

it.live("moves an owned domain to its replacement Worker and observes the resulting route", () =>
  Effect.promise(async () => {
    const requests: { method: string; body: unknown }[] = [];
    const observed = {
      id: "domain-id",
      hostname: "site.example",
      service: "old-worker",
      zone_id: "zone",
    };
    const fresh = { ...observed, service: "replacement-worker" };
    const results = [[observed], { id: "domain-id" }, fresh, [fresh], fresh];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      requests.push({ method: request.method ?? "GET", body: text ? JSON.parse(text) : undefined });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, result: results[requests.length - 1] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
      const client = createSiteClient(
        { accountId: "account", apiToken: "test", apiBaseUrl: base },
        gateway(base),
      );
      const site = worker("site", { entry: "site.ts", compatibilityDate: "2026-07-30" });
      const desired = customDomain("domain", {
        hostname: "site.example",
        zoneId: "zone",
        worker: site,
      });
      const service = cloudflareSiteServices({ client, token: "lease" })[desired.type];
      if (!service) throw new Error("Missing site service");
      const apply = () =>
        service.apply(
          desired,
          "domain-id",
          { definition: desired, physicalId: "domain-id", outputs: { ...observed } },
          { site: { definition: site, physicalId: "replacement-worker", outputs: {} } },
        );
      const outputs = await apply();
      expect(requests.map((request) => request.method)).toEqual(["GET", "PUT", "GET"]);
      await apply();
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
        "GET",
        "GET",
      ]);
      expect(requests[1]?.body).toMatchObject({
        hostname: "site.example",
        service: "replacement-worker",
        zone_id: "zone",
      });
      expect(outputs).toMatchObject({
        id: "domain-id",
        service: "replacement-worker",
        url: "https://site.example",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }),
);

const gateway = (base: string): MutationGateway => ({
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
});
