# Renkin implementation discovery

Confirmed discovery notes, ready for specification and ticket creation.
Unselected recommendations and engineering investigations are not accepted decisions.

## Current agreement

The user confirmed the final summary and shared understanding after the interview.
Use the [architecture](architecture.md) as the current
scope, the [glossary](context/root.md) for terms, and the accepted ADRs for major
trade-offs. Earlier rounds in this document preserve evidence and decision history;
later explicit corrections take precedence.

| Area | Current choice |
| --- | --- |
| Target | Replace Delimoov's fork with fresh infrastructure; preserve required behavior with a simple API |
| Platforms | Cloudflare; TanStack Start Solid SPA/SSR; Astro static/SSR |
| Fork additions | Local presigned R2/S3 behavior, native D1 batch, Access settings and correct public types |
| Runtime | Bun on macOS/Linux; Node and Windows support deferred |
| Dependencies | Effect and external Distilled; no Alchemy package dependencies |
| Design | Redesign internals where useful; do not move complexity into consumer code |
| Local development | One command, no Cloudflare credentials, persistent data and required local bindings/events |
| Lifecycle | Recover resource operations, protect data by default, block competing deployments; mutual Worker calls required |
| State | Automatic encrypted cloud state; private local files; unreadable state is an error |
| Migrations | Plain SQL plus current Delimoov Drizzle journal support; Alchemy's name-based execution history |
| Renames | Explicit logical-ID rename within the same stack/environment/type; no inferred moves |
| Automation | TypeScript API and clean JSON state reads; consumer owns GitHub PR events and cleanup timing |
| Builds | Skip unchanged builds, reuse within a deployment, optional external build command, no extra remote cache |
| Validation | Local checks, real Cloudflare release checks and isolated packed-package consumer checks |
| License | Apache 2.0 with source attribution and applicable third-party notices |

At discovery completion, no implementation, deployment, source extraction, spec
publication or ticket creation had been performed. Documentation whitespace checks
passed; no behavioral tests were run.

The subsequent `to-spec` step published the confirmed scope as
[GitHub issue #3](https://github.com/carere/renkin/issues/3), labeled
`ready-for-agent`. Its [local spec copy](specs/renkin-first-release.md) follows the
regular spec template. The user explicitly confirmed the public API/CLI testing
boundary with focused internal failure tests. Implementation tickets have not yet
been created.

## Objective and existing constraints

Replace the local Alchemy fork used by Delimoov with Renkin. Focus on Cloudflare,
TanStack Start and Astro, retaining Effect and investigating opportunities to
simplify the implementation. No implementation or issue publication is part of
this discovery session.

The [architecture](architecture.md) defines the existing workspace ownership,
acyclic dependency direction, single published package, Effect peer dependency,
and prohibition on Alchemy package dependencies. Round 1 revised the former
preserve-first/simplify-later sequence to permit redesigned internals from the
start with compatibility checks.

## Evidence baseline

- Renkin checkout: `3b4ebc1ffcf2cc93096a273584d79ed61db01367`.
- Renkin is a tooling scaffold with no implemented capabilities and zero tests,
  as documented in [README.md](../README.md). No tests were run for this discovery.
- The root manifest and public package currently declare Effect
  `^4.0.0-rc.115`. This is a checkout observation, not a compatibility conclusion.
- No glossary or ADRs existed at the start of this interview. Resolved domain
  terms belong in `docs/context/root.md`; consequential accepted trade-offs belong
  in `docs/adr/`. This document holds evidence and open questions instead.
- The coding standard links to a context map and contains Delimoov-specific
  frontend conventions, while the domain instructions explicitly select a single
  context. Reconcile applicable conventions before implementation; do not infer
  a new context layout from those stale references.

## Accepted decisions: round 1

1. Behavior compatibility permits changes to consumer declarations, imports and
   test fixtures. The API must remain simple: do not move implementation
   complexity into client code. Exact authoring ergonomics remain to be clarified.
2. Initial scope is Delimoov's actual needs plus TanStack Start Solid SPA/SSR and
   Astro SSG, including fork-added behavior such as presigned URLs. This does not
   require every Alchemy capability within the selected technologies.
3. Redesigned internals are allowed from the start with explicit compatibility
   checks. This replaces the architecture's previous extraction-first sequence.

See [ADR 0001](adr/0001-behavior-compatible-rewrite.md) and the round 2 decisions
below for the later fresh-start choice.

## Source observations

- Local Alchemy checkout: `/Users/carere/Projects/oss/alchemy`, clean at
  `82b7fc24c03db868772a60bb2927054582d22f43`. Local remote-tracking refs are not
  evidence of the current upstream version.
- Local Delimoov checkout: `/Users/carere/Projects/perso/delimoov`, clean at
  `cb885863bb6b91901865700bb947c84742aae069`. The consumer declares the scoped
  fork packages at `2.0.0-beta.79.fork.2` and Effect `4.0.0-rc.115`.
- Delimoov's `packages/cloudflare-resources/src/data.ts:20-35` declares a
  stage-specific R2 bucket, with forced destruction outside staging and retention
  in staging. `packages/infra/resources/storage.ts:16-37` provisions a
  bucket-scoped account API token for preview stages. This differed from the
  original architecture's shared-preview wording, which has now been corrected.
- Delimoov's `packages/infra/resources/review.ts:5-20` uses a named Worker
  entrypoint from the `delimoov-review` stack's `review` stage for protected
  staging/PR surfaces. This is a current cross-stack reference requirement.
- Delimoov's `packages/cloudflare-resources/src/data.ts:8-17` attaches D1
  migrations outside the Alchemy runtime and retains the database in staging.
  The global runtime guard is a candidate to examine when separating deployment
  definitions from runtime bindings.

These observations describe checked-in code, not verified live deployments.
Source paths above are relative to the named checkout and revision; no secrets
or deployed state were inspected.

## Delimoov capability evidence

Paths in this section are relative to the Delimoov checkout above.

| Observed usage | Evidence |
| --- | --- |
| Main stack with local/cloud state selection | `packages/infra/alchemy.run.ts:12-29` |
| Local, staging and PR stages; production explicitly rejected | `packages/infra/environment.ts:21-58` |
| Five native Effect Workers and three website Workers | `packages/infra/resources/services.ts`, `api.ts`, `frontends.ts:15-23` |
| D1 migrations, R2 CORS, KV, two queues and their dead-letter queues | `packages/cloudflare-resources/src/data.ts:8-61` |
| Queue batches, retries and native binding handles | `services/jobs/src/worker.ts:19-67`, `services/notifications/src/worker.ts:21-69` |
| Workflow sleep, tasks, retries and attempt context | `services/jobs/src/contexts/shared/services/workflow-probe/synthetic-workflow.ts:8-44` |
| Durable Object storage, identity and alarms | `services/tracking/src/contexts/shared/services/tracking-probe/tracking-session.ts:4-19` |
| Email resource and send binding; documented local capture | `services/notifications/src/worker.ts:25-34`, `packages/infra/README.md:159-162` |
| Access applications, service tokens, policies and CORS | `packages/infra/resources/access.ts:8-58` |
| Observability, compatibility flags and build hooks | `packages/infra/environment.ts:61-94` |
| Separate retained observability stack | `packages/infra/traces.run.ts:8-30` |
| Permanent review stack with raw Worker, retained D1, static assets and Access | `packages/infra/review.run.ts:10-80` |
| Staging retention for Jobs and Tracking Workers | `packages/infra/resources/services.ts:95,116` |

Console and Customer Hub use TanStack Solid Start SPA with a prerendered index;
Storefront uses SSR. The manifests declare Start `1.168.52`, Router `1.170.34`
and Query `5.102.8`. There is no observed Astro consumer; Renkin needs a separate
Astro validation fixture. These are consumer versions, not selected Renkin ranges.

`packages/infra/resources/frontends.ts:16-70` configures generic Vite websites,
app-relative server entries, per-app roots and ports, SPA/SSR asset fallbacks,
deployment-specific `VITE_` values and explicit build memo inputs. Inputs include
shared packages, translations, source-map upload code, deployment metadata and
the lockfile, while excluding generated router/i18n files. The app Vite config
contains special handling for injected plugins and nested prerender previews
(`apps/console/vite.config.ts:14-26`). Frontend tests reach an internal Alchemy
builder (`packages/infra/tests/support/frontend-build.ts:18`).

The documented local contract includes eight applications, hot reload, migrations,
queues, Workflows, Durable Objects and shared objects between R2 native bindings
and the local S3 endpoint (`packages/infra/README.md:147-166`). The consumer test
fixture uses both public and internal surfaces for in-memory state, temporary
graphs, raw binding handles, restart persistence, migrations, queue/cron dispatch,
email capture and scoped cleanup
(`packages/cloudflare-resources/tests/support/worker-test.ts:5-20,60-119,146-229`).
Its existence does not establish that the tests pass at this revision.

## Migration and documentation discrepancies

Delimoov documents account-level cloud state using a Worker, SQLite Durable Object
and encrypted Secrets Store keys; this is not PR-owned infrastructure
(`packages/infra/README.md:192-197`). Its tooling reads state without evaluating
the stack and preserves redacted values, partly because progress output can precede
CLI JSON (`:241-248`). Preview cleanup uses state plus provider inventory for
discovery, then exact ownership for destruction
(`packages/infra/previews/cloudflare.ts:34-44,89-104`).

Delimoov converts Drizzle journal v0 migrations to ordered flat SQL with hashed
directories (`packages/cloudflare-resources/src/migrations.ts:15-45`). Its README
documents `__alchemy_migrations` history and adoption of historical Wrangler
`d1_migrations` entries (`packages/infra/README.md:38-47`). State format, migration
history and physical-resource takeover were initially open questions. The later
fresh-start decision removes the need to migrate existing deployments or history.
Retention and cross-stack references remain required for new Renkin deployments.

Delimoov's `docs/adr/root/0018-alchemy-environment-infrastructure.md` describes an
older beta.78 setup with a Wrangler bridge and no cross-stack references. Current
code and README describe the native fork runtime and review Worker references.
Treat the ADR as historical evidence pending reconciliation, not proof of current
behavior. No Delimoov documents were changed.

## Alchemy engine and fork evidence

Paths in this section are relative to the Alchemy checkout above.

| Behavior | Evidence and design significance |
| --- | --- |
| Provider lifecycle | `packages/alchemy/src/Provider.ts:291,307,325`: optional precreate; reconcile covers creation, update and adoption |
| Cyclic dependencies | `packages/alchemy/src/Apply.ts:364,417,438,447`, `Plan.ts:1826`: early and stable readiness permit later binding convergence |
| Recovery and replacement | `packages/alchemy/src/State/ResourceState.ts:79,113`, `Apply.ts:1158,1177,1183`: intermediate states and old generations support resumed replacement |
| Retention and dependency updates | `packages/alchemy/src/Apply.ts:712,723`: even a resource no-op persists policy and dependency changes |
| Cross-stack outputs | `packages/alchemy/src/State/State.ts:122`: outputs persist after successful apply |
| Deferred values | `packages/alchemy/src/Output.ts:71,119,189,243,276`: expressions and effectful transformations, beyond promise resolution |
| Runtime configuration | `packages/alchemy/src/Runtime.ts:39,89`: configuration secret transfer and reconstructed redaction |
| Cloud state bootstrap | `packages/alchemy/src/Cloudflare/StateStore/State.ts:68,84,90,108`: local bootstrap state, resume and backend contract versions |
| Runtime declaration correctness | `packages/cloudflare-runtime/src/core/RuntimeServices.ts:59`: preserve external Effect Layer requirements |
| Cloudflare TanStack integration | `packages/alchemy/src/Cloudflare/Website/Vite.ts:47`: generic Vite integration, distinct from the AWS-oriented TanStack adapter |
| Broader upstream Astro integration | `packages/alchemy/src/Cloudflare/Website/Astro.ts:45,59,78,134,287`: SSR, session KV and workerd prerendering exceed ordinary SSG |

Fork commit `579fc78ae` adds local R2 S3 behavior, native D1 batch preservation
through the platform proxy, and Access CORS/eager cookie settings. Relevant source
includes `packages/cloudflare-runtime/src/core/bindings/r2-bucket/R2S3Auth.ts`,
`R2S3.worker.ts`, `R2Bucket.ts`, `core/platform-proxy/connect.ts` and
`packages/alchemy/src/Cloudflare/Access/Application.ts`. Existing R2 S3 and platform
proxy regression suites are evidence to examine before selecting acceptance tests.
Commit `eb5401b76` addresses scoped self-imports and public declaration correctness.
Release-specific fixes may require equivalent consumer verification without
preserving their implementation in Renkin.

## Simplification candidates, not decisions

Follow-up consumer inspection identified repeated runtime-context capture and
provision in service adapters, repeated binding-layer lists, and dummy environment
values for dead-letter queue dependency ordering. Evidence includes
`services/api/src/worker.ts:70-79,129-138`,
`services/api/src/contexts/shared/services/workflow-probe/cloudflare-workflow-probe-service.ts:13-24`
and `packages/infra/resources/services.ts:69-71,89`. Resource use currently gives
typed clients and native handles (`services/auth/src/worker.ts:12-22`). Preserve
those conveniences when considering removal of repetitive wiring. No explicit
resource cycle was found in the inspected consumer declarations; this is not a
compiled graph proof or a decision to exclude cycles.

1. Investigate a smaller way to discover bindings and dependencies. The accepted
   API rules forbid requiring duplicate manual binding lists. Arbitrary Effect
   runtime interception is a possible mechanism, not itself a user requirement.
2. A smaller lifecycle representation could improve clarity. It must not silently
   discard recovery, adoption, cycles, replacement ordering or retention. The size
   of `Apply.ts` and `Plan.ts` alone is not evidence that these semantics are waste.
3. Separate build artifact production from reconciliation, with a public build/test
   seam. Preserve stage-aware inputs, monorepo invalidation, HMR and prerendering.
4. The early proposal to avoid Astro SSR/session machinery is superseded: both
   static and server rendering are required. Simplification must retain those
   paths and the requested Alchemy behavior.
5. Provide supported testing handles, state inspection and migration inputs to
   replace the consumer's current internal imports and workarounds.
6. Restrict runtime/provider machinery to a selected Cloudflare capability matrix.
   Cloudflare-only is still too broad to define that matrix by itself.
7. Establish an explicit concurrency contract. The initial source review did not
   establish a universal local/cloud deployment lock; do not assume concurrent
   deploys are already safe.

## Fork behavior boundary

Follow-up inspection bounded the fork additions; these are source/test findings,
not test execution results. Alchemy paths below use the same baseline revision.

- Local R2 S3 is an opt-in dev endpoint, with local credentials, path-style
  addressing and region `auto`. Signing is the application's responsibility;
  the fork provides endpoint/configuration helpers, not a presigning client API.
- Supported object operations are presigned PUT, GET and HEAD plus unsigned
  OPTIONS. Listing, DELETE and multipart are not implemented. Query SigV4 accepts
  expiry from 1 to 604800 seconds, rejects expired requests and timestamps more
  than 15 minutes ahead, and validates signed headers and request identity.
- Native bindings and the S3 endpoint share persisted objects while isolating
  buckets. Covered cases include encoded keys, HTTP/custom metadata, ETags,
  response overrides, single byte ranges, and proxy/Vite URL forwarding. The
  reserved endpoint takes precedence over SPA fallback.
- Local S3 CORS currently allows all origins and exposes all headers; it does
  not enforce production bucket CORS. Encryption/checksum/storage-class/MD5 and
  chunked upload options are explicitly unsupported.
- Evidence: `packages/cloudflare-runtime/src/core/bindings/r2-bucket/R2S3.worker.ts`,
  `R2S3Auth.ts`, `R2S3Options.shared.ts`, and
  `packages/cloudflare-runtime/src/core/test/bindings/R2S3.test.ts`.
- Native D1 proxy batch passes prepared statements to real `db.batch`, preserves
  result order and transaction rollback, and rejects cross-binding statement
  references. Evidence: `core/platform-proxy/connect.ts:197`,
  `core/platform-proxy/PlatformProxy.worker.ts:231` and
  `core/test/platform-proxy/PlatformProxy.test.ts:89,137` under the runtime package.
- Access additions include `corsHeaders` and `eagerRedirectCookieSetting` across
  create/update/read/diff. Omitted desired fields preserve observed configuration;
  supplied CORS fields merge, array comparisons ignore order, and observed cloud
  results remain authoritative. Evidence:
  `packages/alchemy/src/Cloudflare/Access/Application.ts:143,545,681,730,970,1514`.
- The bounded fork delta also includes helper exports, dev-option forwarding,
  scoped packaging fixes and preservation of Effect Layer type requirements.
  These do not imply a requirement for full S3 compatibility.

## Accepted decisions and follow-up: round 2

4. Start fresh. The user confirms Delimoov is early-stage and has not been
   deployed. Do not require Alchemy state import, existing-resource takeover or
   old migration-history adoption. Earlier source observations describe supported
   code paths, not existing cloud resources. See
   [ADR 0002](adr/0002-start-with-fresh-infrastructure.md).
5. All four API rules are accepted: resource use automatically establishes its
   binding/dependency; avoid repetitive runtime setup plumbing in client code;
   expose native Cloudflare handles; define each Worker implementation once.
6. Recover interrupted deployments, protect retained resources, and prevent
   competing deployments in one environment. Workers calling each other in both
   directions are required in the first release. This does not yet decide how to
   handle every possible circular dependency between arbitrary resources.
7. One local command for the full application graph, without Cloudflare
   credentials, with persistent data and the required queues, Workflows, Durable
   Objects, captured email and presigned R2 operations. The user asks to verify
   the existing Delimoov infra package as the reference experience.
8. The user requests Alchemy's Astro behavior. Investigate its exact static and
   server behavior before settling whether this expands the earlier SSG scope.

The user prefers simple English throughout the interview.

## Round 2 follow-up evidence

### Local command

Delimoov's `packages/infra/moon.yml:5` runs
`alchemy dev --config alchemy.run.ts --stage local`, exposed as
`bun moon run infra:dev`. Its stack selects local state for the local stage and
skips Access creation (`packages/infra/alchemy.run.ts:12-29`). Source inspection
supports the one-command design, but no clean-machine launch was performed.
Do not claim credential-free startup has been verified: shared provider setup
also constructs an authentication layer, which needs further checking. Renkin's
accepted requirement remains local startup without Cloudflare credentials.

The command covers Auth, API, Jobs, Notifications, Tracking and three frontends.
Review and Companion are separate tasks. Local emulator data lives under
`.alchemy/local`; the runtime selects this path in
`packages/infra/node_modules/alchemy/src/Cloudflare/LocalRuntime.ts:71-92`.
Delimoov documents migrations and email capture there. Dummy Google credentials
allow setup but cannot provide real Google login. No existing `.wrangler/state`
import is provided. These limits should remain separate from Renkin's required
local Cloudflare behavior.

### Astro

Alchemy's public Astro API uses assets-only deployment when explicitly configured
with `astro.output: "static"`; otherwise it selects server rendering. Page
generation defaults to workerd, with an optional Node path. Server mode can
automatically create session KV; static mode skips that cloud resource.
Evidence: `packages/alchemy/src/Cloudflare/Website/Astro.ts:59,134,287,325` and
`packages/frontend-frameworks/src/astro/cloudflare.ts:121,134` in Alchemy.

There is an important difference between its public API and lower-level adapter.
The public production build passes simple environment values to its child process
but skips resource objects and Effects; declaring a D1/R2/KV resource in `env`
does not establish access to it while generating pages. The lower-level workerd
page generator can use bindings when explicitly supplied. Evidence:
`packages/frontend-frameworks/src/astro/source.ts:758,815,841,869,922` and
`prerenderer.ts:130`. Do not promise build-time resource access based only on the
adapter README.

### Cloudflare SDK

Alchemy's clean local Distilled submodule is at
`71455a8c2e470cf8725eb7b333456edb9768ece0`; its Cloudflare/core manifests declare
`1.0.0-rc.12`. Alchemy uses workspace dependencies and rewrites selected SDK
packages to fork-scoped names during packaging (`scripts/release/pack.ts:43`).
No public release was checked for equivalence.

SDK errors affect deployment behavior: D1 catches `DatabaseNotFound`
(`packages/alchemy/src/Cloudflare/D1/Database.ts:376`), while R2 catches
`BucketAlreadyExists` (`packages/alchemy/src/Cloudflare/R2/Bucket.ts:1185`). A
replacement must preserve the meaning of these failures. Distilled also depends
on shared protocol, schemas, retries and pagination, so copying selected endpoint
files alone is insufficient. Its Effect HTTP imports require version checks.

The initial recommendation to use Distilled as a normal dependency was rejected
in round 3, then accepted by an explicit correction in round 4. The current choice
is an external Distilled dependency through the SDK package. Review source
licenses and third-party notices before any Alchemy code reuse.

## Accepted decisions: round 3

9. Support both static and server-rendered Astro sites. This expands the earlier
   static-only scope. Alchemy remains the reference behavior for the integration.
10. Copy and maintain the needed SDK code rather than adding an external SDK
    dependency. Distilled is separate from Alchemy, but the user chose the copy
    option to avoid dependency on the source project's packages. See
    [ADR 0003](adr/0003-maintain-selected-sdk-code.md). **Superseded in round 4:**
    use Distilled directly as a dependency instead.
11. Automatically set up Cloudflare storage for deployed state, shared between
    developers and CI. Local development state stays on disk.
12. Renkin creates and deletes named environments. Delimoov's GitHub workflows
    handle PR events and cleanup timing.

## Further source findings

Alchemy Astro SSR creates session KV automatically, accepts an existing binding
and allows session provisioning to be disabled. Static output skips the cloud
session resource (`packages/alchemy/src/Cloudflare/Website/Astro.ts:280-300`).
These are part of the Alchemy reference behavior requested by the user. Astro
SSR and local development receive Worker bindings; this does not remove the
production page-generation limitations noted above.

Alchemy's local state encodes redacted values but does not encrypt them
(`packages/alchemy/src/State/StateEncoding.ts:71,87`, `State/LocalState.ts:115,168,250`).
Its cloud state encrypts records and outputs with a key in Cloudflare Secrets
Store (`packages/alchemy/src/Cloudflare/StateStore/Store.ts:21,39,173,225`,
`Token.ts:43,55`). One historical branch treats a decryption failure as an absent
resource (`Store.ts:56-80`). Renkin should not inherit that behavior silently:
unreadable state and missing state require different handling.

The inspected state interfaces expose no whole-deployment lock. Atomic file or
Durable Object writes alone do not establish safe competing deployments. Renkin's
required protection must cover the whole operation, with recovery after a crash.

## Branches to revisit after prerequisites settle

### Source ownership and dependencies

Local Alchemy, Distilled and the selected Alchemy packages have Apache 2.0 license
files. Their notices include Functionless attribution; some selected runtime and
Astro code has additional MIT/ISC or other source notices recorded by Alchemy.
Distilled's NOTICE refers to a third-party-license file not found in its tracked
tree. Resolve applicable source notices before extraction; this file inventory
does not complete license compliance. Apache 2.0 was later selected for Renkin.

The selected SDK needs request/response handling, schemas, authentication, errors,
pagination and retries, plus selected endpoints and patches. Under the corrected
decision these remain the external SDK's responsibility. Track original paths,
revisions and changes for any Alchemy code separately copied into Renkin.

The fork also uses independent tools such as workerd, Vite, Astro, Rolldown,
esbuild and Node compatibility packages. Miniflare is used in its test helpers;
the main runtime uses workerd and adapted runtime code. Whether to retain any
particular tool is separate from the ban on Alchemy dependencies. Distilled is
explicitly allowed as a direct dependency by the round 4 correction.

### Accepted decisions: round 4

13. Independent runtime/build dependencies are allowed. The user also corrects
    Q10: use Distilled directly as a dependency. Do not copy the SDK into Renkin.
    [ADR 0004](adr/0004-use-distilled-as-a-dependency.md) supersedes ADR 0003.
14. A second deployment targeting the same environment stops with a clear message.
    A crash must not leave a permanent lock. Different environments may deploy
    concurrently; shared resources still need correct ownership boundaries.
15. Encrypt cloud state. Keep ordinary local state files excluded from Git and
    readable only by the current user. Local state may contain secret values.
    Unreadable state must cause a clear error, never be treated as missing state.
16. Support plain SQL and read Drizzle migration files. Renkin should replace
    Delimoov's conversion code; plain SQL users do not need Drizzle.

The later round 5 decision and exact migration reference section below settle
history behavior; use that evidence for the migration specification.

### Migration and lifecycle findings for round 5

Delimoov's Drizzle layout is flat SQL plus `meta/_journal.json`. Its converter
checks contiguous journal indices, unique names and agreement with SQL files,
preserves SQL bytes and names, and writes content-addressed snapshots
(`packages/cloudflare-resources/src/migrations.ts:15-45`). Renkin must support
this actual format; "Drizzle support" alone is too vague. Existing consumer
tests cover names/hashes, fresh application, repeat application and data
preservation (`packages/infra/tests/migrations.test.ts:16-99`). These tests were
inspected, not executed.

The installed Alchemy migration engine skips applied names without checking
their recorded hashes (`packages/infra/node_modules/alchemy/src/SQL/Migrations/AlchemyFormat.ts:198-243`).
Directory hashing triggers reconciliation but does not enforce unchanged history.
Rejecting edited applied SQL would therefore be an improvement, not copied behavior.

Alchemy defaults to resource destruction when a declaration is removed. Its
retain policy leaves the cloud object but drops its state record
(`packages/alchemy/src/RemovalPolicy.ts:5`, `Resource.ts:350` in Alchemy).
This differs from blocking deletion while continuing to manage the object.
Nonempty R2 buckets have an additional refusal unless `forceDestroy` is set;
D1 deletion has no matching data-presence check. Renaming a logical ID may cause
creation/removal; no explicit identity-move command was found. Ordinary variable
renaming is not the same as changing a resource's logical ID.

Alchemy shows a deployment plan and asks for approval, with `--yes` for automation
(`packages/alchemy/src/Cli/Commands/deploy.ts:186-275`). Its state CLI can also
forget records without deleting cloud resources. Renkin's first-release deletion,
rename and state-repair rules should be explicit rather than inherited accidentally.

Delimoov needs stage listing and output reads without evaluating application code
(`packages/infra/previews/cloudflare.ts:34-44`,
`packages/infra/tests/deployed/support/state.ts:12-18`). Preview cleanup requires
exact state ownership; naming patterns only find candidates. Clean JSON output
would remove a current CLI workaround.

### Accepted decisions: round 5

17. Match Alchemy instead of adding strict applied-migration history checks.
    Already-applied names are skipped even if SQL changes. Verify the reference's
    deleted/renamed-file and failure behavior before writing precise acceptance
    criteria; source-format validation remains separate from history validation.
18. Block deletion of resources holding data by default. An explicit setting may
    allow deletion, including automatic cleanup of disposable previews.
19. Provide an explicit logical-ID rename operation that preserves the resource
    and its data. Do not infer renames from similar declarations. See
    [ADR 0005](adr/0005-protect-data-resources-from-deletion.md).
20. Public TypeScript state reads and clean JSON CLI output support automation,
    listing environments and reading outputs without running infrastructure code.
    Keep progress messages separate from JSON.
21. Normal checks run locally without credentials. Before release, run a separate
    real-Cloudflare suite that creates temporary resources and cleans up. This is
    a future validation requirement, not authorization to deploy during discovery.

No deployment or tests were run during discovery.

### Exact migration reference behavior

For an existing normal migration table, changing SQL under an applied name does
not reapply it. Removing an applied file neither rolls it back nor removes its
history. Renaming it ordinarily makes it a new migration, which can fail if the
schema already exists. The legacy `<name>` / `<name>/migration.sql` alias is a
reference implementation detail, not a new legacy-import requirement.

Pending migrations run in order and stop at the first reported error. Earlier
successful migrations remain applied and are skipped on retry. Each migration
and its bookkeeping insert are submitted together to D1; there is no toolkit
transaction covering the entire deployment. Do not promise automatic reversal or
assume that every partially executed migration can recover automatically.

Flat SQL uses numeric-prefix order before unnumbered lexical paths. The fork's
comparator returns equality for equal numeric prefixes despite a comment claiming
a tiebreaker; avoid presenting that comment as a guaranteed ordering rule. An
empty migration directory skips application.

Source evidence in Delimoov's installed fork:
`SQL/Migrations/AlchemyFormat.ts:198-243`, `Registry.ts:164-193`,
`SQL/SqlFile.ts:16-32`, `Cloudflare/D1/ApplyMigrations.ts:29-78` under
`packages/infra/node_modules/alchemy/src/`.

Drizzle journal validation is separate: malformed or inconsistent input can be
rejected without rejecting edits to applied history. Delimoov validates the
journal against SQL files before converting them. A consistent rename in both
the journal and files is still a new migration identity at execution time.

### Remaining release choices

Alchemy's CLI has Node and Bun paths plus Windows path handling
(`packages/alchemy/bin/cli.js:21`); this is not verified cross-platform support.
Delimoov uses Bun/Moon on Ubuntu CI with Node also installed. Its CI supplies
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Alchemy supports additional
OAuth, profile and global-key authentication, but no consumer need for all those
modes has been established.

Alchemy uses persisted input hashes to skip unchanged builds/uploads and a cache
of built artifacts within a single run, not an established remote artifact cache.
See `packages/alchemy/src/Command/Memo.ts:13,27,130`, `Artifacts.ts:8`, and
`Cloudflare/Workers/Sources/Vite.ts:312`. Delimoov disables Moon caching for
deployment tasks, which is separate from Alchemy's build skipping.

Round 6 decisions:

- Q22: Bun on macOS and Linux. Node is not a supported Renkin runtime for the
  first release. Existing repository Node tooling is a separate concern.
- Q23: Cloudflare API token and account ID for deployment; browser login is
  deferred. Local development needs no credentials.
- Q24: Accepted after clarification. Skip unnecessary website builds, reuse work
  within one deployment, allow an external build command such as Moon, and keep
  a standalone build path. Do not add a separate remote build-artifact cache.
- Q25: Apache 2.0, with applicable notices for any reused source. See
  [ADR 0006](adr/0006-use-apache-2-license.md). Creating the final license and
  notice files remains release preparation, not a completed extraction review.

Technical choices such as the state schema, lock implementation and release bundler need bounded investigation
and validation during specification; their mechanisms are not implied by the
accepted user-facing behavior.

Q24 clarification from source: Delimoov's deployment tasks explicitly disable
Moon caching (`packages/infra/moon.yml:38`), while application build tasks declare
their build outputs. A cached build and a skipped deployment are different:
deployment must still inspect/apply the requested infrastructure changes. Changing
only a cron schedule should not require rebuilding an unchanged website.

Accepted Q24 choice: do not add a separate remote build-artifact cache to
Renkin. Detect unchanged website inputs, reuse work within one deployment, and
provide a supported external build-command path that can use Moon. Renkin must
also work outside Moon. This is an agreed future integration, not a verified existing
feature. If an upload needs build files that are absent locally, produce or
restore them; unchanged-deployment detection does not restore build output.

For the license choice, the official
[Apache 2.0 text](https://www.apache.org/licenses/LICENSE-2.0) was checked. Section
4 describes preservation of applicable licenses, change notices and attribution
when distributing copied work. The local source inventory remains necessary for
any extracted code; selecting Renkin's own license does not replace that work.

## Final policy checks

Most user-facing choices are settled. Latest policy answers:

26. Reject the whole operation before changes. After checking the reference, the
    user chooses Alchemy's option meanings: `--yes` skips confirmation, `--force`
    reruns unchanged resources, and explicit resource settings allow deletion.
    These flags do not bypass the separately accepted default data protection.
    Do not add the proposed per-operation deletion bypass or partial-plan mode.
27. Accepted: protect data resource types even when empty, including D1, R2, KV,
    queues, Durable Objects and Workflows, and Workers whose removal would lose
    stored data. Also protect replacement with new resources.
28. Accepted after explanation: rename `Database` to `MainDatabase` while keeping
    the Cloudflare object, within the same stack/environment and resource type.
    Moving ownership between stacks or environments is deferred.

The accepted recovery requirement does not imply
automatic reversal or repair of partially applied SQL; match the migration
reference behavior and surface failures clearly.

Alchemy override evidence for Q26: `--yes` skips plan confirmation, while deploy
`--force` reruns otherwise unchanged resources. Neither is a general bypass of
data protection. Retain leaves the physical resource and forgets its state;
destroy selects removal, and nonempty R2 also requires `forceDestroy: true`.
No general "skip protected resources and apply the rest" option was found.
See `packages/alchemy/src/Cli/Commands/deploy.ts:198,248`,
`Cli/Commands/flags.ts:100`, `RemovalPolicy.ts:5` and
`Cloudflare/R2/Bucket.ts:1297` in the local fork.

The proposed extra override for named resources was not selected: the user chose
Alchemy's resource-setting approach instead. Partial-plan execution is also not
part of the selected behavior.

Engineering work for the specs includes concrete API examples, state schema and
lock recovery, package/release build, supported dependency versions, Astro SSR
fixture placement, cache inputs, test cases and the exact source/license inventory.
These are bounded design and validation tasks, not reopened product choices.
