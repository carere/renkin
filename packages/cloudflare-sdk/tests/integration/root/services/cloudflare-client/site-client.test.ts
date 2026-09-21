import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { createAccessClient } from "../../../../../src/contexts/root/services/cloudflare-client/access-client.ts";
import type {
  GatewayRequest,
  MutationGateway,
} from "../../../../../src/contexts/root/services/cloudflare-client/cloudflare-client.ts";
import { createSiteClient } from "../../../../../src/contexts/root/services/cloudflare-client/site-client.ts";

const fixture = (result: unknown) => {
  const requests: GatewayRequest[] = [];
  const gateway: MutationGateway = {
    request: async (request, token) => {
      expect(token).toBe("fence");
      expect(request.headers?.authorization).toBeUndefined();
      requests.push(request);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(
          JSON.stringify({ success: true, errors: [], messages: [], result }),
        ).toString("base64"),
      };
    },
  };
  return { requests, gateway };
};

it.effect(
  "keeps asset-session authorization scoped to hash upload and preserves multipart bytes",
  () =>
    Effect.gen(function* () {
      const { requests, gateway } = fixture({ jwt: "complete.jwt.token" });
      const client = createSiteClient({ accountId: "account", apiToken: "secret" }, gateway);
      yield* client.uploadAssets(
        { hash: new File(["aGVsbG8="], "hash", { type: "text/html" }) },
        "upload.jwt.token",
        "fence",
      );
      const request = requests[0];
      expect(request?.assetUploadToken).toBe("upload.jwt.token");
      expect(request?.path).toBe("/accounts/account/workers/assets/upload?base64=true");
      const form = yield* Effect.promise(() =>
        new Request("https://api.cloudflare.com/upload", {
          method: "POST",
          headers: request?.headers ?? {},
          body: Buffer.from(request?.bodyBase64 ?? "", "base64"),
        }).formData(),
      );
      const part = form.get("hash") as File;
      expect(part.type).toBe("text/html");
      expect(yield* Effect.promise(() => part.text())).toBe("aGVsbG8=");
    }),
);
it.effect("serializes and decodes Access CORS and eager-cookie false through Distilled", () =>
  Effect.gen(function* () {
    const { requests, gateway } = fixture({
      id: "app",
      type: "self_hosted",
      eager_redirect_cookie_setting: false,
      cors_headers: {
        allow_credentials: false,
        allowed_headers: [],
        allowed_origins: ["https://example.com"],
      },
    });
    const client = createAccessClient({ accountId: "account", apiToken: "secret" }, gateway);
    const observed = yield* client.createApplication(
      {
        name: "name",
        type: "self_hosted",
        eagerRedirectCookieSetting: false,
        corsHeaders: {
          allowCredentials: false,
          allowedHeaders: [],
          allowedOrigins: ["https://example.com"],
        },
      },
      "fence",
    );
    expect(
      JSON.parse(Buffer.from(requests[0]?.bodyBase64 ?? "", "base64").toString()),
    ).toMatchObject({
      eager_redirect_cookie_setting: false,
      cors_headers: { allow_credentials: false, allowed_headers: [] },
    });
    expect(observed).toMatchObject({
      eagerRedirectCookieSetting: false,
      corsHeaders: { allowCredentials: false, allowedHeaders: [] },
    });
    yield* client.updateApplication(
      "app",
      { eagerRedirectCookieSetting: true, corsHeaders: { allowCredentials: true } },
      "fence",
    );
    expect(requests[1]?.path).toBe("/accounts/account/access/apps/app");
  }),
);
it.effect("uses account-scoped domains and preserves disabled previews", () =>
  Effect.gen(function* () {
    const { requests, gateway } = fixture({
      id: "domain",
      hostname: "site.example.com",
      service: "worker",
    });
    yield* createSiteClient({ accountId: "account", apiToken: "secret" }, gateway).putDomain(
      { hostname: "site.example.com", service: "worker", zoneId: "zone", previewsEnabled: false },
      "fence",
    );
    expect(requests[0]?.path).toBe("/accounts/account/workers/domains");
    expect(
      JSON.parse(Buffer.from(requests[0]?.bodyBase64 ?? "", "base64").toString()),
    ).toMatchObject({ zone_id: "zone", previews_enabled: false });
  }),
);
