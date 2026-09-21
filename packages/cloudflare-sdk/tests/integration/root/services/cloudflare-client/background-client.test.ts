import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { createBackgroundClient } from "../../../../../src/contexts/root/services/cloudflare-client/background-client.ts";
import type { GatewayRequest } from "../../../../../src/contexts/root/services/cloudflare-client/cloudflare-client.ts";

const fixture = (failWrites = false) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const calls: { method: string; path: string; body: unknown }[] = [];
      const mutations: GatewayRequest[] = [];
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks).toString();
        calls.push({
          method: request.method ?? "GET",
          path: request.url ?? "",
          body: bytes ? JSON.parse(bytes) : null,
        });
        const failed = failWrites && request.method !== "GET";
        response.writeHead(failed ? 429 : 200, { "content-type": "application/json" });
        const result = request.url?.includes("/consumers")
          ? { consumer_id: "consumer", type: "worker" }
          : request.url?.includes("/schedules")
            ? { schedules: [{ cron: "* * * * *" }] }
            : request.url?.includes("page=")
              ? [{ queue_id: "queue", queue_name: "owned" }]
              : { queue_id: "queue", queue_name: "owned" };
        response.end(
          JSON.stringify({
            success: !failed,
            errors: failed ? [{ code: 1015, message: "limited" }] : [],
            result,
            result_info: { page: 2, per_page: 100, total_pages: 2 },
          }),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = createBackgroundClient(
        { accountId: "account", apiToken: "test-token", apiBaseUrl: origin },
        {
          request: async (request, token) => {
            expect(token).toBe("lease");
            expect(request.headers?.authorization).toBeUndefined();
            mutations.push(request);
            const result = await fetch(`${origin}${request.path}`, {
              method: request.method,
              headers: request.headers ?? {},
              ...(request.bodyBase64 ? { body: Buffer.from(request.bodyBase64, "base64") } : {}),
            });
            return {
              status: result.status,
              headers: Object.fromEntries(result.headers),
              bodyBase64: Buffer.from(await result.arrayBuffer()).toString("base64"),
            };
          },
        },
      );
      return { client, calls, mutations, server };
    }),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

it.effect(
  "actual SDK carries queue pagination, consumer retry/DLQ policy, nullable concurrency and cron through fenced writes",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const page = yield* test.client.listQueues(2);
      expect(page.result[0]?.queueName).toBe("owned");
      expect(test.calls[0]?.path).toBe("/accounts/account/queues?page=2&per_page=100");
      yield* test.client.createConsumer(
        {
          queueId: "queue",
          type: "worker",
          scriptName: "worker",
          deadLetterQueue: "dead",
          settings: {
            batchSize: 2,
            maxWaitTimeMs: 1000,
            maxRetries: 1,
            retryDelay: 3,
            maxConcurrency: null,
          },
        },
        "lease",
      );
      expect(test.calls[1]?.body).toEqual({
        type: "worker",
        script_name: "worker",
        dead_letter_queue: "dead",
        settings: {
          batch_size: 2,
          max_wait_time_ms: 1000,
          max_retries: 1,
          retry_delay: 3,
          max_concurrency: null,
        },
      });
      yield* test.client.putSchedules("worker", ["* * * * *"], "lease");
      expect(test.calls[2]?.body).toEqual([{ cron: "* * * * *" }]);
      expect(test.mutations).toHaveLength(2);
    }),
);

it.effect("a failed queue mutation is never automatically retried", () =>
  Effect.gen(function* () {
    const test = yield* fixture(true);
    yield* Effect.exit(test.client.createQueue("owned", "lease"));
    expect(test.mutations).toHaveLength(1);
    expect(test.calls).toHaveLength(1);
  }),
);
