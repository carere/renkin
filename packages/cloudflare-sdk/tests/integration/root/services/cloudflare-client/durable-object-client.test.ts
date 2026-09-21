import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  createCloudflareClient,
  type GatewayRequest,
} from "../../../../../src/contexts/root/services/cloudflare-client/cloudflare-client.ts";

it.effect("preserves declarative class lifecycle through the Distilled multipart boundary", () =>
  Effect.gen(function* () {
    let captured: GatewayRequest | undefined;
    const client = createCloudflareClient(
      { accountId: "account", apiToken: "secret" },
      {
        request: async (request, token) => {
          expect(token).toBe("fenced");
          captured = request;
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            bodyBase64: Buffer.from(
              JSON.stringify({ success: true, errors: [], messages: [], result: {} }),
            ).toString("base64"),
          };
        },
      },
    );
    const exports = {
      Counter: { type: "durable-object" as const, storage: "sqlite" as const },
      OldCounter: {
        type: "durable-object" as const,
        state: "renamed" as const,
        renamed_to: "Counter",
      },
      Removed: { type: "durable-object" as const, state: "deleted" as const },
    };
    yield* client.putWorker(
      {
        scriptName: "owner",
        metadata: { mainModule: "worker.mjs", exports },
        files: [
          new File(["export default {}"], "worker.mjs", { type: "application/javascript+module" }),
        ],
      },
      "fenced",
    );
    expect(captured?.path).toBe("/accounts/account/workers/scripts/owner");
    expect(captured?.headers?.authorization).toBeUndefined();
    const form = yield* Effect.promise(() =>
      new Request("http://multipart.invalid", {
        method: "POST",
        headers: captured?.headers ?? {},
        body: Buffer.from(captured?.bodyBase64 ?? "", "base64"),
      }).formData(),
    );
    const metadata = form.get("metadata");
    if (typeof metadata !== "string") throw new Error("Expected JSON multipart metadata.");
    expect(JSON.parse(metadata)).toEqual({ main_module: "worker.mjs", exports });
  }),
);
