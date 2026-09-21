import { Effect } from "effect";
import { durableObject, kv } from "renkin/cloudflare";
import { defineDurableObject } from "renkin/durable-object";
import { defineWorker } from "renkin/worker";

export class Counter extends defineDurableObject({ AUDIT: kv("Audit") }) {
  async increment() {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counter (value INTEGER NOT NULL)");
    this.ctx.storage.sql.exec(
      "INSERT INTO counter SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM counter)",
    );
    this.ctx.storage.sql.exec("UPDATE counter SET value = value + 1");
    const value = this.ctx.storage.sql
      .exec<{ value: number }>("SELECT value FROM counter")
      .one().value;
    await this.ctx.storage.put("last", value);
    return { value, id: this.ctx.id.toString() };
  }
  async schedule() {
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    return this.ctx.storage.getAlarm();
  }
  async read() {
    return {
      id: this.ctx.id.toString(),
      last: await this.ctx.storage.get<number>("last"),
      alarm: (await this.ctx.storage.get<number>("alarm")) ?? 0,
    };
  }
  async alarm() {
    await this.ctx.storage.put("alarm", ((await this.ctx.storage.get<number>("alarm")) ?? 0) + 1);
    await this.bindings.AUDIT.native.put("alarm", this.ctx.id.toString());
  }
}

export default defineWorker(
  { COUNTERS: durableObject<Counter>("Counters", { worker: "Api", className: "Counter" }) },
  ({ COUNTERS }) => ({
    fetch: (request) =>
      Effect.gen(function* () {
        const path = new URL(request.url).pathname;
        const result = yield* COUNTERS.call(async (namespace) => {
          const object = namespace.getByName("persistent");
          if (path === "/increment") return object.increment();
          if (path === "/schedule") return object.schedule();
          return object.read();
        });
        return Response.json(result);
      }),
  }),
);
