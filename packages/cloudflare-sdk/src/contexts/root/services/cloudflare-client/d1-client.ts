import * as D1 from "@distilled.cloud/cloudflare/d1";
import { Data, Effect, Stream } from "effect";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export class D1StatementError extends Data.TaggedError("D1StatementError")<{
  readonly statement: number;
  readonly message: string;
}> {}

const checked = <A extends { result: readonly { success?: boolean | null }[] }>(response: A) => {
  const index = response.result.findIndex((statement) => statement.success !== true);
  return !response.result.length || index >= 0
    ? Effect.fail(
        new D1StatementError({
          statement: index,
          message:
            "D1 reported an unsuccessful SQL statement. Inspect database and migration history before retrying.",
        }),
      )
    : Effect.succeed(response);
};

/** SQL uses fenced, non-retrying transport even for reads; SQL text is never classified heuristically. */
export const createD1Client = (config: CloudflareConfig, gateway: MutationGateway) => {
  const transport = createOperationClient(config, gateway);
  return {
    create: (input: Omit<D1.CreateDatabaseRequest, "accountId">, token: string) =>
      transport.write(D1.createDatabase({ ...input, accountId: config.accountId }), token),
    get: (databaseId: string) =>
      transport.read(D1.getDatabase({ accountId: config.accountId, databaseId })),
    list: (name?: string) =>
      transport.read(
        D1.listDatabases
          .items({ accountId: config.accountId, ...(name ? { name } : {}) })
          .pipe(Stream.runCollect),
      ),
    update: (input: Omit<D1.UpdateDatabaseRequest, "accountId">, token: string) =>
      transport.write(D1.updateDatabase({ ...input, accountId: config.accountId }), token),
    remove: (databaseId: string, token: string) =>
      transport.write(D1.deleteDatabase({ accountId: config.accountId, databaseId }), token),
    query: (input: Omit<D1.QueryDatabaseRequest, "accountId">, token: string) =>
      transport
        .write(D1.queryDatabase({ ...input, accountId: config.accountId }), token)
        .pipe(Effect.flatMap(checked)),
    raw: (input: Omit<D1.RawDatabaseRequest, "accountId">, token: string) =>
      transport
        .write(D1.rawDatabase({ ...input, accountId: config.accountId }), token)
        .pipe(Effect.flatMap(checked)),
  };
};
