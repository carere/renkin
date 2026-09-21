import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { createR2Client } from "@renkin/cloudflare-sdk/services/cloudflare-client/r2-client";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { r2 } from "../../../../../src/contexts/root/models/r2.ts";
import { cloudflareR2Service } from "../../../../../src/contexts/root/services/r2/cloudflare-r2-service.ts";

const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    let reads = 0;
    let writes = 0;
    const server = createServer((_request, response) => {
      reads++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          result: {
            name: "owned-name",
            creation_date: "different-creation",
            storage_class: "Standard",
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const client = createR2Client(
      {
        accountId: "account",
        apiToken: "test-token",
        apiBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      },
      {
        request: async () => {
          writes++;
          throw new Error("Unexpected mutation");
        },
      },
    );
    return {
      server,
      service: cloudflareR2Service(client, "lease"),
      counts: () => ({ reads, writes }),
    };
  }),
  ({ server }) =>
    Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
);
const previous: ResourceState = {
  definition: r2("Files", { identity: "pinned" }),
  physicalId: "owned-name",
  outputs: { name: "owned-name", creationDate: "recorded-creation" },
};
it.effect(
  "refuses jurisdiction or location changes hidden behind a pinned identity before any provider request",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      for (const options of [{ jurisdiction: "eu" as const }, { locationHint: "weur" as const }])
        yield* Effect.promise(async () =>
          expect(
            test.service.apply(
              r2("Files", { identity: "pinned", ...options }),
              previous.physicalId,
              previous,
            ),
          ).rejects.toThrow("require explicit resource replacement"),
        );
      expect(test.counts()).toEqual({ reads: 0, writes: 0 });
    }),
);
it.effect("refuses a bucket reincarnated under the same name for both refresh and deletion", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.promise(async () =>
      expect(
        test.service.apply(previous.definition, previous.physicalId, previous),
      ).rejects.toThrow("ownership differs"),
    );
    yield* Effect.promise(async () =>
      expect(test.service.remove(previous)).rejects.toThrow("ownership differs"),
    );
    expect(test.counts()).toEqual({ reads: 2, writes: 0 });
  }),
);
