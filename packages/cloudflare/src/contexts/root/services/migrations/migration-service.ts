import { ResourceOperationError } from "@renkin/core/services/resource/resource-operation-error";
import { Effect } from "effect";
import type { MigrationFile } from "./migration-files.ts";

/** Adapters execute each migration and its history insert at their real database boundary. */
export interface MigrationExecutor {
  initialize(): Promise<void>;
  appliedNames(): Promise<readonly string[]>;
  apply(migration: MigrationFile): Promise<void>;
}

export class MigrationError extends ResourceOperationError {
  readonly name = "MigrationError";
  constructor(readonly migration: string | undefined) {
    super(
      migration === undefined
        ? "Unable to read migration history. No pending migrations were started."
        : `Migration ${migration} failed. Earlier successful migrations remain recorded. Inspect database and history before retrying; manual repair may be required.`,
    );
  }
}

/** History is keyed only by name: edited and deleted applied files do not invalidate it. */
export const applyMigrations = (
  migrations: readonly MigrationFile[],
  executor: MigrationExecutor,
) =>
  Effect.tryPromise({
    try: async () => {
      if (!migrations.length) return [] as string[];
      let applied: ReadonlySet<string>;
      try {
        await executor.initialize();
        applied = new Set(await executor.appliedNames());
      } catch {
        throw new MigrationError(undefined);
      }
      const completed: string[] = [];
      for (const migration of migrations) {
        if (applied.has(migration.name)) continue;
        try {
          await executor.apply(migration);
        } catch {
          throw new MigrationError(migration.name);
        }
        completed.push(migration.name);
      }
      return completed;
    },
    catch: (error) => (error instanceof MigrationError ? error : new MigrationError(undefined)),
  });

export const migrationHistoryTable = "__renkin_migrations";
export const migrationHistoryCreate = `CREATE TABLE IF NOT EXISTS ${migrationHistoryTable} (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
export const migrationHistoryRead = `SELECT name FROM ${migrationHistoryTable} ORDER BY rowid`;
/** A newline keeps a final SQL line-comment from consuming the bookkeeping statement. */
export const migrationSql = (migration: MigrationFile) =>
  `${migration.sql}\n;\nINSERT INTO ${migrationHistoryTable} (name) VALUES ('${migration.name.replaceAll("'", "''")}');`;
