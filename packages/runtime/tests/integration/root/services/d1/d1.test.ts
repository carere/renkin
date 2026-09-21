import type { D1Database as CloudflareD1Database } from "@cloudflare/workers-types";
import { expect, it } from "@effect/vitest";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { d1Client, guardD1, type NativeD1 } from "#src/contexts/root/models/d1.ts";

const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

it.effect("preserves real native batch order, binding provenance and rollback", () =>
  Effect.promise(async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-07-30",
      d1Databases: { A: "database-a", B: "database-b" },
    });
    try {
      const a = guardD1((await mf.getD1Database("A")) as unknown as NativeD1);
      const b = guardD1((await mf.getD1Database("B")) as unknown as NativeD1);
      await a.exec("CREATE TABLE data (value TEXT)");
      const result = await a.batch([
        a.prepare("INSERT INTO data VALUES (?)").bind("one"),
        a.prepare("SELECT value FROM data"),
        a.prepare("INSERT INTO data VALUES (?)").bind("two"),
        a.prepare("SELECT value FROM data ORDER BY rowid"),
      ]);
      expect(result[1]?.results).toEqual([{ value: "one" }]);
      expect(result[3]?.results).toEqual([{ value: "one" }, { value: "two" }]);
      expect(() => a.batch([b.prepare("SELECT 1")])).toThrow("belong to this database");
      await expect(
        a.batch([
          a.prepare("INSERT INTO data VALUES ('rolled back')"),
          a.prepare("INSERT INTO missing VALUES (1)"),
        ]),
      ).rejects.toThrow();
      expect(await a.prepare("SELECT COUNT(*) AS count FROM data").first("count")).toBe(2);
      expect(
        await a.prepare("SELECT value FROM data ORDER BY rowid").raw({ columnNames: true }),
      ).toEqual([["value"], ["one"], ["two"]]);
      const session = a.withSession("first-primary");
      expect((await session.batch([session.prepare("SELECT 7 AS value")]))[0]?.results).toEqual([
        { value: 7 },
      ]);
      const client = d1Client(a, "A");
      expect(
        await Effect.runPromise(
          client.first<{ value: string }>("SELECT value FROM data WHERE value = ?", ["two"]),
        ),
      ).toEqual({ value: "two" });
    } finally {
      await mf.dispose();
    }
  }),
);

it.effect("native handles work with the actual Drizzle D1 adapter", () =>
  Effect.promise(async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-07-30",
      d1Databases: { DB: "drizzle-db" },
    });
    try {
      const client = d1Client((await mf.getD1Database("DB")) as unknown as NativeD1, "DB");
      const native: CloudflareD1Database = client.native;
      await native.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
      const database = drizzle(native);
      await database.insert(users).values({ id: 1, name: "Ada" });
      expect(await database.select().from(users).all()).toEqual([{ id: 1, name: "Ada" }]);
      const result = await database.batch([
        database.insert(users).values({ id: 2, name: "Grace" }),
        database.select().from(users).orderBy(users.id),
      ]);
      expect(result[1]).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ]);
    } finally {
      await mf.dispose();
    }
  }),
);
