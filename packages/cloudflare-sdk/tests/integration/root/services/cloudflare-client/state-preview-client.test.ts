import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { readStateAuth } from "#src/contexts/root/services/cloudflare-client/state-preview-client.ts";

const secret = "a".repeat(64);
const endpoint = "https://coordinator.example.workers.dev/";
const exchangeUrl = "https://preview-token.example.workers.dev/cdn-cgi/workers/preview/";
const input = { scriptName: "coordinator", endpoint, probeSource: "export default {}" };
interface Scenario {
  exchange?: string;
  secret?: string;
  redirect?: boolean;
  denied?: boolean;
  exchangeFailure?: "http" | "malformed" | "missing" | "network" | "redirect";
}

const exchangeResponse = (failure: Scenario["exchangeFailure"]) => {
  if (failure === "network") throw new Error("exchange unavailable");
  return new Response(failure === "malformed" ? "invalid JSON" : "{}", {
    status: failure === "http" ? 400 : failure === "redirect" ? 302 : 200,
    headers: failure === "redirect" ? { location: "https://attacker.invalid/" } : {},
  });
};

const fixture = (scenario: Scenario = {}) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const calls: Request[] = [];
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(String(req.headers["x-test-url"]), {
          method: req.method ?? "GET",
          headers: Object.fromEntries(
            Object.entries(req.headers).flatMap(([key, value]) =>
              typeof value === "string" ? [[key, value]] : [],
            ),
          ),
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        calls.push(request);
        const url = new URL(request.url);
        if (url.hostname === "coordinator.example.workers.dev") {
          res.writeHead(
            scenario.redirect ? 302 : 200,
            scenario.redirect ? { location: "https://attacker.invalid/" } : {},
          );
          res.end(scenario.secret ?? secret);
          return;
        }
        const result = url.pathname.endsWith("/edge-preview")
          ? req.method === "POST"
            ? { preview_token: "preview-token" }
            : {
                token: "session-token",
                ...(scenario.exchange ? { exchange_url: scenario.exchange } : {}),
              }
          : url.pathname.endsWith("/subdomain")
            ? { subdomain: "example" }
            : null;
        res.writeHead(scenario.denied ? 403 : 200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            url.hostname === "preview-token.example.workers.dev"
              ? { token: "exchanged-token" }
              : scenario.denied
                ? { success: false, errors: [{ code: 10000, message: secret }] }
                : { success: true, result, errors: [] },
          ),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const fetch: typeof globalThis.fetch = (url, init) => {
        expect(init?.redirect).toBe("error");
        if (String(url) === exchangeUrl && scenario.exchangeFailure) {
          expect(new Headers(init?.headers).has("authorization")).toBe(false);
          return Promise.resolve().then(() => exchangeResponse(scenario.exchangeFailure));
        }
        return globalThis.fetch(base, {
          ...init,
          headers: { ...Object.fromEntries(new Headers(init?.headers)), "x-test-url": String(url) },
        });
      };
      return {
        calls,
        fetch,
        server,
        config: { accountId: "account", apiToken: "api-secret", apiBaseUrl: `${base}/client/v4` },
      };
    }),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

describe("authenticated state preview", () => {
  for (const exchange of [undefined, exchangeUrl]) {
    it.live(`recovers inherited secret ${exchange ? "with" : "without"} exchange`, () =>
      Effect.gen(function* () {
        const test = yield* fixture(exchange ? { exchange } : {});
        const result = yield* readStateAuth(test.config, input).pipe(
          Effect.provideService(FetchHttpClient.Fetch, test.fetch),
        );
        expect(result).toBe(secret);
        for (const call of test.calls) {
          expect(call.headers.get("authorization")).toBe(
            new URL(call.url).protocol === "http:" ? "Bearer api-secret" : null,
          );
        }
        const upload = test.calls.find((call) => call.method === "POST");
        expect(upload?.headers.get("cf-preview-upload-config-token")).toBe(
          exchange ? "exchanged-token" : "session-token",
        );
        const form = yield* Effect.promise(async () => upload?.formData());
        expect(JSON.parse(String(form?.get("metadata")))).toMatchObject({
          bindings: [{ type: "inherit", name: "RENKIN_STATE_AUTH" }],
          main_module: "probe.js",
        });
        expect(JSON.parse(String(form?.get("wrangler-session-config")))).toMatchObject({
          workers_dev: true,
          minimal_mode: true,
        });
        expect(test.calls.at(-1)?.headers.get("cf-workers-preview-token")).toBe("preview-token");
      }).pipe(Effect.scoped),
    );
  }
});

describe("preview rejects unsafe responses", () => {
  for (const scenario of [
    { exchange: "https://attacker.invalid/cdn-cgi/workers/preview/" },
    { exchange: "https://preview-token.other.workers.dev/cdn-cgi/workers/preview/" },
    { exchange: "http://preview-token.example.workers.dev/cdn-cgi/workers/preview/" },
    { secret: "" },
    { secret: "A".repeat(64) },
    { redirect: true },
    { denied: true },
  ]) {
    it.live(`sanitizes ${JSON.stringify(Object.keys(scenario))}`, () =>
      Effect.gen(function* () {
        const test = yield* fixture(scenario);
        const error = yield* readStateAuth(test.config, input).pipe(
          Effect.provideService(FetchHttpClient.Fetch, test.fetch),
          Effect.flip,
        );
        expect(error._tag).toBe("StatePreviewError");
        expect(String(error)).not.toContain(secret);
        expect(test.calls.some((call) => call.url.includes("attacker.invalid"))).toBe(false);
      }).pipe(Effect.scoped),
    );
  }
  it.live("rejects a mismatched endpoint before requesting a preview", () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      yield* readStateAuth(test.config, {
        ...input,
        endpoint: "https://other.example.workers.dev/",
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, test.fetch), Effect.flip);
      expect(test.calls).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
});

describe("optional token exchange", () => {
  for (const exchangeFailure of ["http", "malformed", "missing", "network", "redirect"] as const) {
    it.live(`uses original session token after ${exchangeFailure} failure`, () =>
      Effect.gen(function* () {
        const test = yield* fixture({ exchange: exchangeUrl, exchangeFailure });
        expect(
          yield* readStateAuth(test.config, input).pipe(
            Effect.provideService(FetchHttpClient.Fetch, test.fetch),
          ),
        ).toBe(secret);
        expect(
          test.calls
            .find((call) => call.method === "POST")
            ?.headers.get("cf-preview-upload-config-token"),
        ).toBe("session-token");
        expect(test.calls.some((call) => call.url.includes("attacker.invalid"))).toBe(false);
      }).pipe(Effect.scoped),
    );
  }
});
