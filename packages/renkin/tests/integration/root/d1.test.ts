import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack } from "renkin";
import { d1 } from "renkin/cloudflare";
import { createD1Fixture } from "../../support/root/d1-fixture.ts";

it.effect(
  "public D1 clients, native proxy and migrations preserve data across restart and logical rename",
  () =>
    Effect.promise(async () => {
      const test = await createD1Fixture();
      try {
        await test.run(async ({ workers, database, bindings }) => {
          const api = workers.Api;
          if (!api) throw new Error("Missing Worker");
          expect(await (await api.fetch()).json()).toEqual([{ id: 1, name: "Ada" }]);
          expect(await (await api.fetch("/write")).text()).toBe("ok");
          expect(await (await api.fetch("/native")).json()).toEqual([["name"], ["Ada"], ["Grace"]]);
          expect(await (await api.fetch("/cross")).text()).toBe("rejected");
          const native = await database("Database");
          const foreign = await database("Other");
          expect(() => native.batch([foreign.prepare("SELECT 1")])).toThrow(
            "belong to this database",
          );
          expect(await database("Database")).toBe(native);
          expect((await bindings("Api")).DB).toBeDefined();
        });
        await test.run(async ({ database }) => {
          expect(
            await (await database("Database"))
              .prepare("SELECT COUNT(*) AS count FROM users")
              .first("count"),
          ).toBe(2);
        });
        await writeFile(
          test.entry,
          (await readFile(test.entry, "utf8")).replace('d1("Database")', 'd1("Renamed")'),
        );
        const renamed = defineStack({
          ...test.stack,
          renames: [{ from: "Database", to: "Renamed" }],
          resources: [
            d1("Renamed", { migrations: test.migrations }),
            ...test.stack.resources.filter((resource) => resource.id !== "Database"),
          ],
        });
        await test.run(async ({ database }) => {
          expect(
            await (await database("Renamed"))
              .prepare("SELECT COUNT(*) AS count FROM users")
              .first("count"),
          ).toBe(2);
        }, renamed);
      } finally {
        await test.close();
      }
    }),
  30000,
);

it.effect(
  "public local startup resumes corrected migrations without erasing edited or deleted history",
  () =>
    Effect.promise(async () => {
      const test = await createD1Fixture();
      try {
        await test.run(async () => {});
        await rm(join(test.migrations, "meta"), { recursive: true });
        await writeFile(join(test.migrations, "0000_initial.sql"), "INVALID EDITED SQL");
        await writeFile(
          join(test.migrations, "0001_success.sql"),
          "INSERT INTO users VALUES (2,'Grace')",
        );
        await writeFile(
          join(test.migrations, "0002_failure.sql"),
          "INSERT INTO missing VALUES (3)",
        );
        await writeFile(
          join(test.migrations, "0003_later.sql"),
          "INSERT INTO users VALUES (4,'Later')",
        );
        await expect(test.run(async () => {})).rejects.toThrow("manual repair may be required");
        await writeFile(
          join(test.migrations, "0002_failure.sql"),
          "INSERT INTO users VALUES (3,'Fixed')",
        );
        await rm(join(test.migrations, "0000_initial.sql"));
        await test.run(async ({ database }) => {
          const db = await database("Database");
          expect(await db.prepare("SELECT COUNT(*) AS count FROM users").first("count")).toBe(4);
          expect(
            (await db.prepare("SELECT name FROM __renkin_migrations ORDER BY rowid").all()).results,
          ).toHaveLength(4);
        });
        await rename(
          join(test.migrations, "0003_later.sql"),
          join(test.migrations, "0004_renamed.sql"),
        );
        await expect(test.run(async () => {})).rejects.toThrow("0004_renamed.sql");
      } finally {
        await test.close();
      }
    }),
  30000,
);

it.effect(
  "public local plans protect data and explicit replacement allocates fresh storage",
  () =>
    Effect.promise(async () => {
      const test = await createD1Fixture();
      try {
        await test.run(async ({ database }) => {
          await (await database("Database"))
            .prepare("INSERT INTO users VALUES (2,'User data')")
            .run();
        });
        const replaced = (allowDelete: boolean) =>
          defineStack({
            ...test.stack,
            resources: [
              d1("Database", { migrations: test.migrations, identity: "replacement", allowDelete }),
              ...test.stack.resources.filter((resource) => resource.id !== "Database"),
            ],
          });
        await expect(test.run(async () => {}, replaced(false))).rejects.toThrow(
          "Deletion protection",
        );
        await test.run(async ({ database }) => {
          expect(
            await (await database("Database"))
              .prepare("SELECT COUNT(*) FROM users")
              .first("COUNT(*)"),
          ).toBe(2);
        });
        await test.run(async ({ database }) => {
          expect(
            await (await database("Database"))
              .prepare("SELECT COUNT(*) FROM users")
              .first("COUNT(*)"),
          ).toBe(1);
        }, replaced(true));
      } finally {
        await test.close();
      }
    }),
  30000,
);
