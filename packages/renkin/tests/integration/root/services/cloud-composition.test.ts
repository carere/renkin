import { expect, it } from "@effect/vitest";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { vi } from "vitest";
import { cloudEnvironment } from "#src/contexts/root/services/cloud-environment.ts";

const envelope = (result: unknown) => ({ success: true, errors: [], messages: [], result });
const observation = (path: string) => {
  if (path.endsWith("/renkin-state-v2/settings"))
    return {
      tags: ["renkin-state-v2"],
      bindings: [
        { type: "plain_text", name: "ACCOUNT_ID", text: "account" },
        { type: "secret_text", name: "RENKIN_STATE_AUTH" },
        {
          type: "durable_object_namespace",
          name: "STATE_COORDINATOR",
          class_name: "StateCoordinator",
        },
      ],
    };
  if (path.endsWith("/app/settings"))
    return { tags: ["renkin:composition:test:app"], bindings: [] };
  if (path.endsWith("/workers/subdomain")) return { subdomain: "test-account" };
  if (path.endsWith("/subdomain/edge-preview")) return { token: "test-upload" };
  if (path.endsWith("/edge-preview")) return { preview_token: "test-preview" };
  if (path.endsWith("/app/subdomain") || path.endsWith("/renkin-state-v2/subdomain"))
    return { enabled: true, previews_enabled: false };
  if (path.endsWith("/durable_objects/namespaces")) return [];
  if (path.endsWith("/app/schedules")) return { schedules: [] };
  throw new Error(`Unexpected provider observation: ${path}`);
};

const wire = () => {
  const writes: { path: string; bodyBase64?: string }[] = [];
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response("a".repeat(64));
    if (path === "/v1/identity") return Response.json({ protocol: 1, accountId: "account" });
    if (path === "/v1/acquire") return Response.json({ token: "test-lease" });
    if (path === "/v1/release") return Response.json({ released: true });
    if (path === "/v1/mutate") {
      const body = (await request.json()) as {
        token: string;
        request: { path: string; bodyBase64?: string };
      };
      expect(body.token).toBe("test-lease");
      writes.push(body.request);
      return Response.json({
        status: 200,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(JSON.stringify(envelope({}))).toString("base64"),
      });
    }
    return Response.json(envelope(observation(path)));
  });
  return { writes, close: () => mock.mockRestore() };
};

it("public cloud composition publishes Worker schedules through the fenced SDK client", async () => {
  const test = wire();
  try {
    const environment = await Effect.runPromise(
      cloudEnvironment("composition", "test", {
        accountId: "account",
        apiToken: "test-token",
      }),
    );
    const lease = await Effect.runPromise(environment.state.acquire("composition", "test"));
    try {
      const resource: ResourceState = {
        definition: {
          id: "App",
          type: "cloudflare.worker",
          identity: "worker",
          properties: {
            source: "export default {fetch(){return new Response('ready')}}",
            compatibilityDate: "2026-07-30",
            compatibilityFlags: [],
            crons: ["0 0 * * *"],
          },
        },
        physicalId: "app",
        outputs: { managedCrons: true },
      };
      await Effect.runPromise(
        environment.services(lease)["cloudflare.worker"]?.bind?.(resource, { App: resource }) ??
          Effect.void,
      );
      const schedule = test.writes.find((request) => request.path.endsWith("/app/schedules"));
      expect(schedule).toBeDefined();
      expect(JSON.parse(Buffer.from(schedule?.bodyBase64 ?? "", "base64").toString())).toEqual([
        { cron: "0 0 * * *" },
      ]);
    } finally {
      await Effect.runPromise(lease.release());
    }
  } finally {
    test.close();
  }
});
