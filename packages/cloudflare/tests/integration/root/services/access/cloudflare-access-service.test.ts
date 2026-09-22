import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { createAccessClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/access-client";
import type { MutationGateway } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { accessApplication, accessServiceToken } from "#src/contexts/root/models/access.ts";
import { cloudflareAccessServices } from "#src/contexts/root/services/access/cloudflare-access-service.ts";

const provider = (results: unknown[]) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
      const server = createServer(async (request, response) => {
        const bytes: Buffer[] = [];
        for await (const chunk of request) bytes.push(Buffer.from(chunk));
        const body = Buffer.concat(bytes).toString();
        requests.push({
          method: request.method ?? "GET",
          path: request.url ?? "",
          body: body ? JSON.parse(body) : {},
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: results[requests.length - 1],
            result_info: { page: 1, total_pages: 1 },
          }),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
      const gateway: MutationGateway = {
        request: async (request) => {
          if (request.receiptOnly)
            return {
              status: 200,
              headers: { "content-type": "application/json" },
              bodyBase64: Buffer.from(JSON.stringify({ success: true, result: {} })).toString(
                "base64",
              ),
            };
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
      return {
        requests,
        server,
        client: createAccessClient(
          { accountId: "account", apiToken: "test", apiBaseUrl: base },
          gateway,
        ),
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

it.live(
  "updates supplied fields, preserves omitted settings and returns the authoritative read",
  () =>
    Effect.gen(function* () {
      const observed = {
        id: "app",
        name: "app-allocation",
        type: "self_hosted",
        domain: "site.example",
        session_duration: "8h",
        eager_redirect_cookie_setting: true,
        cors_headers: {
          allowed_origins: ["https://frontend.example"],
          allowed_headers: ["x-old"],
          allow_credentials: true,
          max_age: 600,
        },
      };
      const fresh = {
        ...observed,
        eager_redirect_cookie_setting: false,
        cors_headers: { ...observed.cors_headers, allowed_headers: ["x-new"] },
      };
      const fixture = yield* provider([[observed], observed, { id: "app" }, fresh]);
      const desired = accessApplication("app", {
        name: "app",
        corsHeaders: { allowedHeaders: ["x-new"] },
        eagerRedirectCookieSetting: false,
      });
      const previous: ResourceState = {
        definition: desired,
        physicalId: "app",
        outputs: { id: "app", ownershipName: "app-allocation" },
      };
      const service = cloudflareAccessServices({ client: fixture.client, token: "lease" })[
        desired.type
      ];
      if (!service) throw new Error("missing service");
      const result = yield* service.apply(desired, "app", previous);
      expect(fixture.requests[2]?.body).toMatchObject({
        session_duration: "8h",
        eager_redirect_cookie_setting: false,
        cors_headers: {
          allowed_origins: ["https://frontend.example"],
          allowed_headers: ["x-new"],
          allow_credentials: true,
          max_age: 600,
        },
      });
      expect(fixture.requests[2]?.body).not.toHaveProperty("policies");
      expect(result).toMatchObject({
        id: "app",
        sessionDuration: "8h",
        eagerRedirectCookieSetting: false,
        corsHeaders: { allowedHeaders: ["x-new"] },
      });
    }).pipe(Effect.scoped),
);
it.live("rejects a foreign resource before a mutation", () =>
  Effect.gen(function* () {
    const fixture = yield* provider([[{ id: "app", name: "foreign", type: "self_hosted" }]]);
    const desired = accessApplication("app", { name: "app", domain: "site.example" });
    const service = cloudflareAccessServices({ client: fixture.client, token: "lease" })[
      desired.type
    ];
    if (!service) throw new Error("missing service");
    const error = yield* service
      .apply(desired, "app", {
        definition: desired,
        physicalId: "app",
        outputs: { ownershipName: "ours" },
      })
      .pipe(Effect.flip);
    expect(String(error)).toContain("ownership");
    expect(fixture.requests).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.live("does not create or rotate a token when its one-time secret receipt is missing", () =>
  Effect.gen(function* () {
    const fixture = yield* provider([
      [{ id: "provider-token", name: "token-allocation", duration: "1h" }],
    ]);
    const desired = accessServiceToken("token", { name: "token", duration: "1h" });
    const service = cloudflareAccessServices({ client: fixture.client, token: "lease" })[
      desired.type
    ];
    if (!service) throw new Error("missing service");
    const error = yield* service.apply(desired, "allocation", undefined).pipe(Effect.flip);
    expect(String(error)).toContain("one-time");
    expect(fixture.requests.map((request) => request.method)).toEqual(["GET"]);
  }).pipe(Effect.scoped),
);
