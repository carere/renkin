import type { createD1Client } from "@renkin/cloudflare-sdk/services/cloudflare-client/d1-client";
import { Effect } from "effect";
import {
  type MigrationExecutor,
  migrationHistoryCreate,
  migrationHistoryRead,
  migrationSql,
} from "./migration-service.ts";

/** One fenced HTTP raw query contains SQL and bookkeeping for each migration. */
export const cloudflareD1MigrationExecutor = (
  client: ReturnType<typeof createD1Client>,
  databaseId: string,
  token: string,
): MigrationExecutor => ({
  initialize: async () => {
    await Effect.runPromise(client.raw({ databaseId, sql: migrationHistoryCreate }, token));
  },
  appliedNames: async () => {
    const response = await Effect.runPromise(
      client.query({ databaseId, sql: migrationHistoryRead }, token),
    );
    return response.result
      .flatMap((result) => result.results ?? [])
      .map((row) => {
        if (!row || typeof row !== "object" || !("name" in row) || typeof row.name !== "string")
          throw new Error("Invalid migration history response.");
        return row.name;
      });
  },
  apply: async (migration) => {
    await Effect.runPromise(client.raw({ databaseId, sql: migrationSql(migration) }, token));
  },
});
