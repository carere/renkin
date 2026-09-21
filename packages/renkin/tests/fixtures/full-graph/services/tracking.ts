import { Effect } from "effect";
import { durableObject } from "renkin/cloudflare";
import { defineDurableObject } from "renkin/durable-object";
import { defineWorker } from "renkin/worker";
import { Audit } from "../shared/resources.ts";

export class OrderEvents extends defineDurableObject({ Audit }) {
  async record(id: string) {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY)");

    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO events (id) VALUES (?)", id);
    await this.ctx.storage.setAlarm(Date.now() + 500);
    return this.read();
  }
  async read() {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY)");
    return {
      id: this.ctx.id.toString(),
      count: this.ctx.storage.sql
        .exec<{ count: number }>("SELECT count(*) AS count FROM events")
        .one().count,
      alarms: (await this.ctx.storage.get<number>("alarms")) ?? 0,
    };
  }
  async alarm() {
    await this.ctx.storage.put("alarms", ((await this.ctx.storage.get<number>("alarms")) ?? 0) + 1);
    await this.bindings.Audit.native.put("alarm", "observed");
  }
}
export default defineWorker(
  {
    Events: durableObject<OrderEvents>("Events", { worker: "Tracking", className: "OrderEvents" }),
    Audit,
  },
  ({ Events, Audit }) => ({
    fetch: (request) =>
      Effect.gen(function* () {
        const result = yield* Events.call(async (namespace) => {
          const object = namespace.getByName("orders");
          return request.method === "POST"
            ? object.record(((await request.json()) as { id: string }).id)
            : object.read();
        });
        return Response.json(result);
      }),
    scheduled: (controller) =>
      Effect.gen(function* () {
        yield* Audit.put("scheduled", controller.cron);
      }),
  }),
);
