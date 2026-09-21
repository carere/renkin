import type { NativeD1 } from "@renkin/runtime/models/d1";
import {
  type MigrationExecutor,
  migrationHistoryCreate,
  migrationHistoryRead,
  migrationSql,
} from "./migration-service.ts";

/** Executes the complete migration and bookkeeping in one native batch call. */
export const nativeD1MigrationExecutor = (database: NativeD1): MigrationExecutor => ({
  initialize: async () => {
    await database.exec(migrationHistoryCreate);
  },
  appliedNames: async () => {
    const result = await database.prepare(migrationHistoryRead).all<{ name: string }>();
    if (!result.success || result.results.some((row) => typeof row.name !== "string"))
      throw new Error("Invalid migration history response.");
    return result.results.map((row) => row.name);
  },
  apply: async (migration) => {
    const results = await database.batch([database.prepare(migrationSql(migration))]);
    if (!results.length || results.some((result) => !result.success))
      throw new Error("D1 reported a failed migration statement.");
  },
});
