import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { d1Client, guardD1, type NativeD1 } from "../../../../../src/contexts/root/models/d1.ts";

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
