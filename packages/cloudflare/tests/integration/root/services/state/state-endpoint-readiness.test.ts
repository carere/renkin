import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { waitForStateEndpoint } from "#src/contexts/root/services/state/state-endpoint-readiness.ts";

const server = (statuses: readonly number[], accountId = "account") =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: { path: string; method: string; authorization: string | undefined }[] = [];
      const http = createServer((request, response) => {
        requests.push({
          path: request.url ?? "",
          method: request.method ?? "",
          authorization: request.headers.authorization,
        });
        response.writeHead(statuses[Math.min(requests.length - 1, statuses.length - 1)] ?? 500, {
          "content-type": "application/json",
          location: "/unexpected-redirect",
        });
        response.end(JSON.stringify({ protocol: 1, accountId }));
      });
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      return {
        http,
        requests,
        input: {
          endpoint: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
          stateAuthToken: "test-state-secret",
          accountId: "account",
        },
      };
    }),
    ({ http }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            http.close((error) => (error ? reject(error) : resolve()));
            http.closeAllConnections();
          }),
      ),
  );

it.live("waits through route propagation using only authenticated identity reads", () =>
  Effect.gen(function* () {
    const boundary = yield* server([404, 404, 200]);
    yield* waitForStateEndpoint(boundary.input);
    expect(boundary.requests).toEqual(
      Array.from({ length: 3 }, () => ({
        path: "/v1/identity",
        method: "POST",
        authorization: "Bearer test-state-secret",
      })),
    );
  }).pipe(Effect.scoped),
);

for (const status of [401, 403, 500, 302]) {
  it.live(`does not retry status ${status} or follow a redirect`, () =>
    Effect.gen(function* () {
      const boundary = yield* server([status]);
      yield* Effect.promise(() =>
        expect(Effect.runPromise(waitForStateEndpoint(boundary.input))).rejects.toThrow(),
      );
      expect(boundary.requests).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
}

it.live("rejects a different account and bounds persistent missing-route responses", () =>
  Effect.gen(function* () {
    const foreign = yield* server([200], "foreign");
    yield* Effect.promise(() =>
      expect(Effect.runPromise(waitForStateEndpoint(foreign.input))).rejects.toThrow("identity"),
    );
    const missing = yield* server([404]);
    yield* Effect.promise(() =>
      expect(Effect.runPromise(waitForStateEndpoint(missing.input, 50))).rejects.toThrow(),
    );
    expect(missing.requests.length).toBeLessThanOrEqual(1);
  }).pipe(Effect.scoped),
);

it.live("does not schedule another probe when the final deadline sleep wakes early", () =>
  Effect.gen(function* () {
    const missing = yield* server([404]);
    const originalTimeout = globalThis.setTimeout;
    const timer = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) =>
        originalTimeout(
          callback,
          delay !== undefined && delay > 0 && delay < 500 ? 0 : delay,
          ...args,
        ),
      );
    try {
      yield* Effect.promise(() =>
        expect(Effect.runPromise(waitForStateEndpoint(missing.input, 400))).rejects.toThrow(
          "deadline",
        ),
      );
      expect(missing.requests).toHaveLength(1);
      expect(
        timer.mock.calls.some(([, delay]) => delay !== undefined && delay > 0 && delay < 500),
      ).toBe(true);
    } finally {
      timer.mockRestore();
    }
  }).pipe(Effect.scoped),
);
