import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { CloudflareStateRepository } from "#src/contexts/root/services/state/cloudflare-state-repository.ts";

const boundary = () =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const actions: string[] = [];
      const server = createServer((request, response) => {
        actions.push(request.url ?? "");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(request.url === "/v1/acquire" ? { token: "lease" } : null));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return {
        server,
        actions,
        repository: new CloudflareStateRepository({
          endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          apiToken: "account-test",
          stateAuthToken: "state-test",
        }),
      };
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      ),
  );

it.effect(
  "starts lazily, renews through Effect's clock, and stops renewal when the lease is released",
  () =>
    Effect.gen(function* () {
      const { repository, actions } = yield* boundary();
      const acquisition = repository.acquire("app", "preview");
      expect(actions).toEqual([]);
      const lease = yield* Effect.acquireRelease(acquisition, (lease) =>
        lease.release().pipe(Effect.orDie),
      );
      yield* TestClock.adjust("15 seconds");
      // The native round trip lets the renewal request complete before observing its count.
      yield* lease.read();
      expect(actions).toContain("/v1/renew");
      yield* lease.release();
      const released = [...actions];
      yield* TestClock.adjust("45 seconds");
      expect(actions).toEqual(released);
      const failure = yield* lease.read().pipe(Effect.flip);
      expect(failure.kind).toBe("busy");
      expect(actions).toEqual(released);
      yield* lease.release();
      expect(actions.filter((action) => action === "/v1/release")).toHaveLength(1);
    }).pipe(Effect.scoped),
);
