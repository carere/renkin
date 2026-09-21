import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { build } from "esbuild";
import { type Request as EmulatorRequest, Miniflare, Response } from "miniflare";

const bundle = () =>
  Effect.promise(() =>
    build({
      entryPoints: [new URL("./recovery-fixture.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
    }),
  );

it.live("restricts upload JWTs to the exact asset endpoint and never persists them", () =>
  Effect.gen(function* () {
    const script = yield* bundle();
    const authorizations: string[] = [];
    const emulator = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new Miniflare({
            modules: true,
            script: script.outputFiles[0]?.text ?? "",
            compatibilityDate: "2026-08-01",
            bindings: { ACCOUNT_ID: "account", RENKIN_STATE_AUTH: "state-secret" },
            durableObjects: {
              STATE_COORDINATOR: { className: "StateCoordinator", useSQLite: true },
            },
            outboundService: async (request: EmulatorRequest) => {
              authorizations.push(request.headers.get("authorization") ?? "");
              return new Response("unknown", { status: 503 });
            },
          }),
      ),
      (emulator) => Effect.promise(() => emulator.dispose()),
    );
    const call = (action: string, input: Record<string, unknown> = {}) =>
      emulator.dispatchFetch(`https://state.test/v1/${action}`, {
        method: "POST",
        headers: {
          authorization: "Bearer state-secret",
          "x-renkin-cloudflare-token": "provider-secret",
        },
        body: JSON.stringify({ stack: "stack", environment: "assets", ...input }),
      });
    const lease = yield* Effect.promise(
      async () => (await (await call("acquire")).json()) as { token: string },
    );
    for (const path of [
      "/accounts/account/access/apps",
      "/accounts/other/workers/assets/upload?base64=true",
      "/accounts/account/workers/assets/upload?base64=true&redirect=other",
    ]) {
      const response = yield* Effect.promise(() =>
        call("mutate", {
          token: lease.token,
          request: { method: "POST", path, assetUploadToken: "upload.jwt.secret" },
        }),
      );
      expect([400, 403]).toContain(response.status);
    }
    expect(authorizations).toEqual([]);
    yield* Effect.promise(() =>
      call("mutate", {
        token: lease.token,
        request: {
          method: "POST",
          path: "/accounts/account/workers/assets/upload?base64=true",
          assetUploadToken: "upload.jwt.secret",
          bodyBase64: Buffer.from("asset").toString("base64"),
        },
      }),
    );
    expect(authorizations).toEqual(["Bearer upload.jwt.secret"]);
    const raw = yield* Effect.promise(async () => await (await call("test-raw")).text());
    const inspection = yield* Effect.promise(async () => await (await call("inspect")).text());
    expect(raw).not.toContain("upload.jwt.secret");
    expect(inspection).not.toMatch(/upload.jwt.secret|provider-secret|state-secret/);
    expect(inspection).toContain("operationId");
  }).pipe(Effect.scoped),
);
