import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { createCloudflareClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createDurableObjectClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/durable-object-client";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { durableObject } from "#src/contexts/root/models/durable-object.ts";
import { cloudflareDurableObjectService } from "#src/contexts/root/services/durable-object/cloudflare-durable-object-service.ts";
import { durableObjectMetadata } from "#src/contexts/root/services/durable-object/worker-durable-objects.ts";

const owner: ResourceState = {
  definition: {
    id: "Api",
    type: "cloudflare.worker",
    identity: "worker",
    protection: { data: true, allowDelete: true },
    properties: { compatibilityDate: "2026-07-30", durableObjectClasses: [] },
  },
  physicalId: "owned-api",
  outputs: { durableObjectClasses: ["Counter"] },
};
const object: ResourceState = {
  definition: durableObject("Counters", { worker: "Api", className: "Counter", allowDelete: true }),
  physicalId: "allocation",
  outputs: { worker: "owned-api", className: "Counter", namespaceId: "namespace" },
};
const fixture = async (namespaces: readonly unknown[]) => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`);
    const result = request.url?.includes("/namespaces")
      ? namespaces
      : { tags: ["renkin:app:test:owned-api"] };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, errors: [], messages: [], result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    accountId: "account",
    apiToken: "credential",
    apiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
  const gateway = {
    request: async () => {
      throw new Error("No mutation is permitted by this contract fixture.");
    },
  };
  return {
    paths,
    service: cloudflareDurableObjectService({
      client: createDurableObjectClient(config, gateway),
      workers: createCloudflareClient(config, gateway),
      token: "fence",
      stack: "app",
      environment: "test",
      desired: [],
    }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

it.effect("a recreated provider namespace cannot inherit the old namespace's ownership", () =>
  Effect.gen(function* () {
    const test = yield* Effect.acquireRelease(
      Effect.promise(() =>
        fixture([{ id: "recreated", class: "Counter", script: "owned-api", use_sqlite: true }]),
      ),
      (test) => Effect.promise(test.close),
    );
    yield* Effect.promise(async () => {
      await expect(
        test.service.apply(object.definition, object.physicalId, object, { Api: owner }),
      ).rejects.toThrow("identity changed");
      await expect(test.service.remove(object, { Api: owner, Counters: object })).rejects.toThrow(
        "replaced namespace",
      );
      expect(test.paths.every((path) => path.startsWith("GET "))).toBe(true);
    });
  }),
);

it.effect("refuses namespace adoption and retirement of a foreign class on an owned Worker", () =>
  Effect.gen(function* () {
    const test = yield* Effect.acquireRelease(
      Effect.promise(() =>
        fixture([
          { id: "namespace", class: "Counter", script: "owned-api", use_sqlite: true },
          { id: "foreign", class: "Foreign", script: "owned-api", use_sqlite: true },
        ]),
      ),
      (test) => Effect.promise(test.close),
    );
    yield* Effect.promise(async () => {
      await expect(
        test.service.apply(object.definition, "new-allocation", undefined, { Api: owner }),
      ).rejects.toThrow("Cannot adopt");
      await expect(test.service.remove(object, { Api: owner, Counters: object })).rejects.toThrow(
        "unowned or protected",
      );
      expect(test.paths.every((path) => path.startsWith("GET "))).toBe(true);
    });
  }),
);
it.effect(
  "requires authoritative SQLite namespace observation and preserves retained classes",
  () =>
    Effect.gen(function* () {
      const test = yield* Effect.acquireRelease(
        Effect.promise(() =>
          fixture([{ id: "namespace", class: "Counter", script: "owned-api", use_sqlite: false }]),
        ),
        (test) => Effect.promise(test.close),
      );
      yield* Effect.promise(async () => {
        await expect(test.service.bind?.(object, { Api: owner, Counters: object })).rejects.toThrow(
          "verified as SQLite",
        );
        expect(() =>
          durableObjectMetadata(owner, {
            Counters: { ...object, definition: { ...object.definition, retain: true } },
          }),
        ).toThrow("Retained Durable Object");
      });
    }),
);
