import { defineWorker, workerReference } from "@carere/renkin/worker";
import { defineWorkflow } from "@carere/renkin/workflow";
import { Effect } from "effect";
import { Audit, OrderFlow, Orders } from "#test-fixtures/full-graph/shared/resources.ts";

export const FulfillOrder = defineWorkflow(
  {
    Orders,
    Notifications: workerReference("Notifications"),
    Tracking: workerReference("Tracking"),
  },
  (event, steps, { Orders, Notifications, Tracking }) =>
    Effect.gen(function* () {
      yield* steps.task(
        "fulfill",
        () =>
          Effect.gen(function* () {
            yield* Orders.query("UPDATE orders SET status = 'complete' WHERE id = ?", [
              (event.payload as { id: string }).id,
            ]);
            yield* Notifications.call((service) =>
              service.fetch(
                new Request("https://notifications/", {
                  method: "POST",
                  body: JSON.stringify(event.payload),
                }),
              ),
            );
            yield* Tracking.call((service) =>
              service.fetch(
                new Request("https://tracking/record", {
                  method: "POST",
                  body: JSON.stringify(event.payload),
                }),
              ),
            );
            return { id: (event.payload as { id: string }).id };
          }),
        // This step includes email: do not intentionally repeat its external side effect.
        { retries: { limit: 0, delay: "1 second" } },
      );
      return { id: (event.payload as { id: string }).id };
    }),
);
export default defineWorker({ OrderFlow, Audit }, ({ OrderFlow, Audit }) => ({
  queue: (batch) =>
    Effect.gen(function* () {
      for (const message of batch.messages) {
        const body = message.body as { id: string; poison?: boolean };
        if (body.poison) {
          yield* Audit.put("poison-attempts", String(message.attempts));
          message.retry({ delaySeconds: 0 });
          continue;
        }
        yield* OrderFlow.create({ id: body.id, params: body });
        message.ack();
      }
    }),
  async fetch(request) {
    return Response.json(
      await (await OrderFlow.native.get(new URL(request.url).pathname.slice(1))).status(),
    );
  },
}));
