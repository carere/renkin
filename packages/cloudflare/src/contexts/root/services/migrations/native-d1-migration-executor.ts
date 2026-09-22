import type { NativeD1 } from "@renkin/runtime/models/d1";
import { Effect } from "effect";
import {
  type MigrationExecutor,
  migrationHistoryCreate,
  migrationHistoryRead,
  migrationSql,
} from "./migration-service.ts";

/** Executes the complete migration and bookkeeping in one native batch call. */
export const nativeD1MigrationExecutor = (database: NativeD1): MigrationExecutor => ({
  initialize: () =>
    Effect.tryPromise(() => database.exec(migrationHistoryCreate)).pipe(Effect.asVoid),
  appliedNames: () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise(() =>
        database.prepare(migrationHistoryRead).all<{ name: string }>(),
      );
      if (!result.success || result.results.some((row) => typeof row.name !== "string"))
        return yield* Effect.fail(new Error("Invalid migration history response."));
      return result.results.map((row) => row.name);
    }),
  apply: (migration) =>
    Effect.gen(function* () {
      const results = yield* Effect.tryPromise(() =>
        database.batch([database.prepare(migrationSql(migration))]),
      );
      if (!results.length || results.some((result) => !result.success))
        return yield* Effect.fail(new Error("D1 reported a failed migration statement."));
    }),
});
