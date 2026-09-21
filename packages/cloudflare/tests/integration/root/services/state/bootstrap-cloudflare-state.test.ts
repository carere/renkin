import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterAll, vi } from "vitest";
import {
  ensureCloudflareState,
  findCloudflareState,
} from "../../../../../src/contexts/root/services/state/bootstrap-cloudflare-state.ts";

const originalFetch = globalThis.fetch;
const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).hostname === "renkin-test-state.example-account.workers.dev") {
    expect(request.headers.get("cf-workers-preview-token")).toBe("preview-token");
    expect(request.headers.get("authorization")).toBeNull();
    return new Response("a".repeat(64));
  }
  return originalFetch(input, init);
});

afterAll(() => fetchMock.mockRestore());

const owned = {
  tags: ["renkin-state-v2"],
  bindings: [
    { type: "secret_text", name: "RENKIN_STATE_AUTH" },
    { type: "plain_text", name: "ACCOUNT_ID", text: "account" },
    { type: "durable_object_namespace", name: "STATE_COORDINATOR", class_name: "StateCoordinator" },
  ],
};

const provider = (observation: unknown, failure?: { status: number; code: number }) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const mutations: string[] = [];
      const uploads: string[] = [];
      const server = createServer((request, response) => {
        if (request.method !== "GET" && !request.url?.endsWith("/edge-preview"))
          mutations.push(`${request.method} ${request.url}`);
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          if (request.method === "PUT") uploads.push(Buffer.concat(chunks).toString());
          const isSettings = request.url?.endsWith("/settings");
          response.writeHead(isSettings && failure ? failure.status : 200, {
            "content-type": "application/json",
          });
          response.end(
            JSON.stringify({
              success: !(isSettings && failure),
              errors:
                isSettings && failure ? [{ code: failure.code, message: "provider detail" }] : [],
              result: isSettings
                ? observation
                : request.url?.endsWith("/workers/subdomain")
                  ? { subdomain: "example-account" }
                  : request.url?.endsWith("/subdomain/edge-preview")
                    ? { token: "upload-token" }
                    : request.url?.endsWith("/edge-preview")
                      ? { preview_token: "preview-token" }
                      : { enabled: true },
            }),
          );
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return {
        mutations,
        uploads,
        server,
        config: {
          accountId: "account",
          apiToken: "test-token",
          stateScriptName: "renkin-test-state",
          apiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`,
        },
      };
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => {
              error ? reject(error) : resolve();
            }),
          ),
      ),
  );

it.live("reuses owned state without replacing the Worker or keys", () =>
  Effect.gen(function* () {
    const boundary = yield* provider(owned);
    const result = yield* Effect.promise(() => ensureCloudflareState(boundary.config));
    expect(result.endpoint).toBe("https://renkin-test-state.example-account.workers.dev");
    expect(boundary.uploads).toEqual([]);
    expect(boundary.mutations).toEqual([]);
    expect(result.stateAuthToken).toBe("a".repeat(64));
  }).pipe(Effect.scoped),
);

for (const observation of [
  { ...owned, tags: [] },
  { ...owned, bindings: owned.bindings.filter((binding) => binding.name !== "RENKIN_STATE_AUTH") },
  { ...owned, bindings: [{ type: "plain_text", name: "ACCOUNT_ID", text: "foreign-account" }] },
]) {
  it.live("refuses foreign state infrastructure before mutation", () =>
    Effect.gen(function* () {
      const boundary = yield* provider(observation);
      yield* Effect.promise(() =>
        expect(ensureCloudflareState(boundary.config)).rejects.toThrow("already occupied"),
      );
      expect(boundary.mutations).toEqual([]);
    }).pipe(Effect.scoped),
  );
}

it.live("does not interpret account authentication failure as missing state", () =>
  Effect.gen(function* () {
    const boundary = yield* provider(null, { status: 403, code: 10000 });
    yield* Effect.promise(() =>
      expect(ensureCloudflareState(boundary.config)).rejects.toThrow("credentials and permissions"),
    );
    expect(boundary.mutations).toEqual([]);
  }).pipe(Effect.scoped),
);

it.live("provisions a missing coordinator with a SQLite class and no stored account token", () =>
  Effect.gen(function* () {
    const boundary = yield* provider(null, { status: 404, code: 10007 });
    const result = yield* Effect.promise(() => ensureCloudflareState(boundary.config));
    expect(result.scriptName).toBe("renkin-test-state");
    expect(boundary.uploads).toHaveLength(1);
    expect(boundary.uploads[0]).toContain('"new_sqlite_classes":["StateCoordinator"]');
    expect(boundary.uploads[0]).toContain('"name":"ACCOUNT_ID"');
    expect(boundary.uploads[0]).not.toContain("test-token");
  }).pipe(Effect.scoped),
);

it.live("discovers existing state without mutations", () =>
  Effect.gen(function* () {
    const boundary = yield* provider(owned);
    const result = yield* Effect.promise(() => findCloudflareState(boundary.config));
    expect(result?.endpoint).toBe("https://renkin-test-state.example-account.workers.dev");
    expect(boundary.mutations).toEqual([]);
  }).pipe(Effect.scoped),
);

it.live("returns absent state without provisioning it", () =>
  Effect.gen(function* () {
    const boundary = yield* provider(null, { status: 404, code: 10007 });
    const result = yield* Effect.promise(() => findCloudflareState(boundary.config));
    expect(result).toBeUndefined();
    expect(boundary.mutations).toEqual([]);
  }).pipe(Effect.scoped),
);
