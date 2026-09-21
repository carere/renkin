# D1 databases and migrations

D1 databases are data resources, protected from deletion and replacement even
when empty. Declare a database with `d1("Database", { migrations: "./migrations" })`
from `renkin/cloudflare`. Pass the same resource descriptor to `defineWorker`'s
requirements to obtain a typed Effect client and its native D1 handle. The Worker
binding and provisioning dependency follow this use automatically.

```ts
import { Effect } from "effect";
import { d1 } from "renkin/cloudflare";
import { defineWorker } from "renkin/worker";

export const database = d1("Database", { migrations: "./migrations" });
export default defineWorker({ DB: database }, ({ DB }) => ({
  fetch: () => Effect.gen(function* () {
    const row = yield* DB.first<{ count: number }>("SELECT COUNT(*) AS count FROM users");
    return Response.json(row);
  }),
}));
```

List the database and Worker in the stack's resources. `DB.native` preserves
`prepare`, chained `bind`, `first`, `all`, `raw`, `run`, `batch`, `exec` and
`withSession`. It is structurally compatible with Cloudflare's D1Database and
works with the Drizzle D1 adapter. Statements passed to a native batch must come
from that database's guarded handle or its session; another binding's statements
are rejected before reaching D1. Native query result ordering and failures remain
those of the actual runtime. Drizzle is a development-only compatibility test
dependency, not required by Renkin or plain SQL consumers.

`readReplication` updates the existing database. `jurisdiction`,
`primaryLocationHint`, and explicit `identity` participate in physical replacement
identity. Replacement or removal requires `allowDelete: true`; neither `--yes`
nor `--force` enables deletion. For removal, first deploy the explicit permission
on the resource, then remove the declaration. Retention keeps the provider object
and forgets its ownership; it does not authorize deleting protected data.

## Accepted migration inputs

The migration reader accepts plain `.sql` files recursively, or the Delimoov
pre-v1 Drizzle layout with flat `.sql` files and `meta/_journal.json`. No conversion
step or Drizzle dependency is needed. "Version-zero" refers to this layout, not a
literal JSON version: Delimoov's `version: "7"` journal with entry version `"6"`
is supported. Entry `idx` values must match contiguous array positions, tags must
be unique valid names, and the ordered journal must exactly match SQL filenames.
An empty directory or matching empty journal does no database work, including no
history-table creation. Malformed or unreadable input fails before deployment.

Names and UTF-8 bytes are snapshotted before planning. BOM, comments, line endings
and statement-breakpoint comments are preserved. Invalid UTF-8 is rejected rather
than silently replaced. Plain SQL ordering follows the reference numeric-prefix
comparator: numeric prefixes first, numerically; nonnumeric names use locale
comparison. The prefix uses integer parsing, including partially numeric text.
Equal numeric prefixes retain the filesystem enumeration order. That ambiguity
is intentionally not converted into checksum rejection or a new history rule;
use distinct numeric prefixes for portable ordering. Drizzle journal ordering
uses the consumer's English numeric filename comparison and must agree with its
entries. SQL files changed after preparation do not change the selected snapshot.

## History and failure behavior

Renkin records successful names in `__renkin_migrations`. Applied names are skipped
even if their SQL changes. Removing an applied file preserves its history and
application data. Renaming a file creates a new migration name; it can fail if its
SQL tries to recreate existing schema. There is no checksum-based rejection or
legacy Alchemy/Wrangler history import.

Pending migrations run sequentially. Each complete migration and its history
insert are sent together: one native batch request locally, one fenced D1 HTTP
raw-query request in the cloud. History initialization and reads are separate
operations. The SDK inspects each statement's success flag even when HTTP and the
overall provider envelope report success. SQL mutations are never automatically
retried by the SDK.

A failed migration stops later migrations. Earlier successful migrations remain
recorded and are skipped on retry. Failure messages identify the migration and
require inspection of database and history before retry: provider transport
failure can leave an unknown outcome, and arbitrary SQL may require manual repair.
There is no all-deployment transaction or automatic SQL repair promise. Unknown
provider outcomes also follow the explicit coordinator reconciliation policy.

Local integration tests use real Miniflare D1 storage and demonstrate ordered
batches, failure rollback, SQL-plus-history rollback, restart persistence,
name-based history, malformed journals and an actual Drizzle adapter. The separately authorized public real-D1 suite passed on 2026-09-21, including
typed/native Worker access, protection, read-replication update with stable
identity, repeat migrations, SQL/bookkeeping failure and correction, edited and
deleted history, renamed-file behavior, and explicit cleanup. Local evidence
alone is not a claim about provider behavior.

Reference behavior was investigated at Alchemy commit
`82b7fc24c03db868772a60bb2927054582d22f43` and Delimoov commit
`cb885863bb6b91901865700bb947c84742aae069`; no upstream source was copied.
The authorized D1 boundary probe on 2026-09-21 observed rollback for both a later
SQL failure and a failed bookkeeping insert within the exact raw-query request.
Earlier successful migrations remained applied, and corrected SQL succeeded on
retry. This evidence applies to those requests; transport failures still require
outcome inspection and can require manual repair.

Run credential-free checks with `bun vitest run --project integration` in
`packages/cloudflare`, `packages/runtime`, and `packages/renkin`. Run the separate
public real-D1 suite from `packages/renkin` with
`bun vitest run --config vitest.cloud.config.ts tests/cloud/root/d1.test.ts`
only after configuring the explicit account, prefix, product and expiry test
authorization variables. The suite logs its owned environment and performs
explicit protected-resource cleanup. Cloud tests are not part of default local
or CI checks. Removed or replaced local database namespaces may leave unbound
emulator persistence files; removal does not promise physical disk erasure.
