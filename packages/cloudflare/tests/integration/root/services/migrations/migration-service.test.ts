import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { guardD1, type NativeD1 } from "@renkin/runtime/models/d1";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import {
  applyMigrations,
  migrationHistoryTable,
} from "#src/contexts/root/services/migrations/migration-service.ts";
import { nativeD1MigrationExecutor } from "#src/contexts/root/services/migrations/native-d1-migration-executor.ts";

const migration = (name: string, sql: string) => ({
  name,
  sql,
  bytes: Buffer.from(sql),
  hash: "unused-for-history",
});
const database = Effect.acquireRelease(
  Effect.promise(async () => {
    const directory = await mkdtemp(join(tmpdir(), "renkin-d1-migrations-"));
    const start = () =>
      new Miniflare({
        modules: true,
        script: "export default {fetch(){return new Response('ok')}}",
        compatibilityDate: "2026-07-30",
        d1Databases: { DB: "migration-db" },
        defaultPersistRoot: directory,
      });
    const mf = start();
    const db = guardD1((await mf.getD1Database("DB")) as unknown as NativeD1);
    return { directory, mf, db, start };
  }),
  asyncEffectCleanup,
);
function asyncEffectCleanup(value: { mf: Miniflare; directory: string }) {
  return Effect.promise(async () => {
    await value.mf.dispose();
    await rm(value.directory, { recursive: true, force: true });
  });
}

it.effect(
  "runs whole migrations plus history and preserves edits/deletions/renames across restart",
  () =>
    Effect.gen(function* () {
      const fixture = yield* database;
      const executor = nativeD1MigrationExecutor(fixture.db);
      const files = [
        migration(
          "0000_init.sql",
          "CREATE TABLE data (value TEXT);\nINSERT INTO data VALUES ('kept');",
        ),
        migration("0001_more.sql", "INSERT INTO data VALUES ('second'); -- final comment"),
      ];
      expect(yield* applyMigrations(files, executor)).toEqual(files.map((file) => file.name));
      expect(
        yield* applyMigrations([migration("0000_init.sql", "THIS SQL IS NOW INVALID")], executor),
      ).toEqual([]);
      expect(
        yield* applyMigrations(
          [migration("0002_renamed.sql", "INSERT INTO data VALUES ('second')")],
          executor,
        ),
      ).toEqual(["0002_renamed.sql"]);
      expect(yield* Effect.promise(() => executor.appliedNames())).toEqual([
        "0000_init.sql",
        "0001_more.sql",
        "0002_renamed.sql",
      ]);
      yield* Effect.promise(async () => {
        await fixture.mf.dispose();
        fixture.mf = fixture.start();
        const reopened = await fixture.mf.getD1Database("DB");
        expect(
          (await reopened.prepare("SELECT value FROM data ORDER BY rowid").all()).results,
        ).toEqual([{ value: "kept" }, { value: "second" }, { value: "second" }]);
      });
    }),
);

it.effect(
  "stops after failed SQL and failed bookkeeping; earlier migrations remain and skip on retry",
  () =>
    Effect.gen(function* () {
      const { db } = yield* database;
      const executor = nativeD1MigrationExecutor(db);
      const initial = migration("0000_init.sql", "CREATE TABLE data (value TEXT)");
      const failed = migration(
        "0001_failure.sql",
        "INSERT INTO data VALUES ('rolled back'); INSERT INTO absent VALUES (1)",
      );
      const later = migration("0002_later.sql", "INSERT INTO data VALUES ('later')");
      const error = yield* applyMigrations([initial, failed, later], executor).pipe(Effect.flip);
      expect(error.migration).toBe(failed.name);
      expect(yield* Effect.promise(() => executor.appliedNames())).toEqual([initial.name]);
      expect(
        yield* Effect.promise(() => db.prepare("SELECT COUNT(*) FROM data").first("COUNT(*)")),
      ).toBe(0);
      expect(
        yield* applyMigrations(
          [initial, migration(failed.name, "INSERT INTO data VALUES ('fixed')"), later],
          executor,
        ),
      ).toEqual([failed.name, later.name]);
      const bookkeepingFailure = migration(
        "0003_history.sql",
        `INSERT INTO data VALUES ('unrecorded'); DROP TABLE ${migrationHistoryTable};`,
      );
      yield* applyMigrations([bookkeepingFailure], executor).pipe(Effect.flip);
      expect(yield* Effect.promise(() => executor.appliedNames())).toEqual([
        initial.name,
        failed.name,
        later.name,
      ]);
      expect(
        yield* Effect.promise(() => db.prepare("SELECT COUNT(*) FROM data").first("COUNT(*)")),
      ).toBe(2);
    }),
);

it.effect("empty input does not even create a history table", () =>
  Effect.gen(function* () {
    const { db } = yield* database;
    expect(yield* applyMigrations([], nativeD1MigrationExecutor(db))).toEqual([]);
    expect(
      yield* Effect.promise(() =>
        db
          .prepare("SELECT name FROM sqlite_master WHERE name = ?")
          .bind(migrationHistoryTable)
          .first(),
      ),
    ).toBe(null);
  }),
);
