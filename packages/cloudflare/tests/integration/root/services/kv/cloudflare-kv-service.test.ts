import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { createKVClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/kv-client";
import { emptyState } from "@renkin/core/models/state";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import { deploy } from "@renkin/core/use-cases/deploy";
import { Effect } from "effect";
import { kv } from "#src/contexts/root/models/kv.ts";
import { cloudflareKVService } from "#src/contexts/root/services/kv/cloudflare-kv-service.ts";

const seedNamespace = async (state: FileStateRepository) => {
  const initial = emptyState("app", "preview");
  initial.resources.Cache = {
    definition: kv("Cache"),
    physicalId: "old-provider-id",
    outputs: { id: "old-provider-id", title: "original-allocation" },
  };
  const lease = await state.acquire("app", "preview");
  await lease.write(initial);
  await lease.release();
};

it.effect(
  "allowed namespace replacement stores a new provider ID and deletes only the old namespace",
  () =>
    Effect.promise(async () => {
      const requests: { method: string; path: string; body: unknown }[] = [];
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString();
        const body = text ? JSON.parse(text) : {};
        requests.push({ method: request.method ?? "GET", path: request.url ?? "", body });
        const result =
          request.method === "POST"
            ? { id: "new-provider-id", title: body.title, jurisdiction: "eu" }
            : request.method === "DELETE"
              ? {}
              : [{ id: "old-provider-id", title: "original-allocation" }];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: true, errors: [], messages: [], result }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = createKVClient(
        { accountId: "account", apiToken: "test", apiBaseUrl: origin },
        {
          request: async (request, token) => {
            expect(token).toBeTruthy();
            expect(request.headers?.authorization).toBeUndefined();
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
        },
      );
      const directory = await mkdtemp(join(tmpdir(), "renkin-kv-replace-"));
      const state = new FileStateRepository(directory);
      try {
        await seedNamespace(state);
        const result = await Effect.runPromise(
          deploy(
            { name: "app", resources: [kv("Cache", { jurisdiction: "eu", allowDelete: true })] },
            {
              environment: "preview",
              state,
              yes: true,
              services: (lease) => ({ "cloudflare.kv": cloudflareKVService(client, lease.token) }),
            },
          ),
        );
        expect(result.resources.Cache?.physicalId).toBe("new-provider-id");
        expect((await state.read("app", "preview"))?.resources.Cache?.physicalId).toBe(
          "new-provider-id",
        );
        expect(
          requests.filter((request) => request.method === "DELETE").map((request) => request.path),
        ).toEqual(["/accounts/account/storage/kv/namespaces/old-provider-id"]);
        expect(requests.find((request) => request.method === "POST")?.body).toMatchObject({
          jurisdiction: "eu",
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }),
);
