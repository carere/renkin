## Problem Statement

Delimoov depends on a local Alchemy fork for Cloudflare infrastructure, application
builds and local development. The fork adds behavior Delimoov needs, but also
includes providers, frameworks and internal machinery outside the intended scope
of Renkin. Delimoov contains workarounds for migration formats, runtime setup,
dependency ordering and access to internal build and test APIs.

Renkin currently has a tooling foundation and empty workspaces, with zero
behavioral tests. It cannot yet replace the fork. Delimoov has not been deployed,
so the replacement can start with fresh resources and state.

The goal is behavior compatibility with a simple client API, not identical
imports or identical internals. A rewrite must not make application code more
complicated or silently lose required behavior.

## Solution

Build one published Effect-based package, Renkin, for Bun on macOS and Linux.
Support Delimoov's required Cloudflare resources, TanStack Start with Solid in
SPA and SSR modes, and Astro in static and SSR modes. Include the fork's local
presigned R2 support, native D1 batch behavior and Access settings.

Provide one-command local development without Cloudflare credentials, cloud
deployment using an API token and account ID, safe resource lifecycle operations,
SQL and Drizzle migrations, public testing helpers, and clean automation APIs.
Use Distilled directly as a dependency. Do not depend on Alchemy packages.

Keep the agreed package ownership. Redesign internals when it reduces complexity
while preserving the required behavior. This spec defines the first complete
release; it will be split into verifiable implementation tickets separately.

## User Stories

1. As a Delimoov developer, I want to replace the Alchemy fork with Renkin, so that I can maintain a toolkit focused on the platforms I use.
2. As a developer, I want simple resource declarations, so that changing the toolkit does not add application boilerplate.
3. As a developer, I want resource use to establish bindings and deployment dependencies, so that I do not maintain duplicate lists.
4. As a developer, I want resource clients to work inside Effect application adapters without repeatedly passing runtime setup objects, so that infrastructure details stay out of my use cases.
5. As a developer, I want native Cloudflare handles alongside typed clients, so that I can use libraries such as Drizzle.
6. As a developer, I want to define each Worker implementation once and supply deployment options separately, so that local and cloud configuration do not duplicate code.
7. As a developer, I want both ordinary Workers and Effect-based Workers, so that existing Delimoov services can use Renkin.
8. As a developer, I want Workers to call each other, including in both directions and through named entrypoints, so that services can collaborate.
9. As a developer, I want cron schedules and service bindings, so that scheduled and service-to-service work behaves correctly.
10. As a developer, I want D1, R2 and KV resources, so that applications can store data using the required Cloudflare services.
11. As a developer, I want to use queues with batch settings, retries and dead-letter queues, so that failed background work follows the configured policy.
12. As a developer, I want Workflow tasks, sleep, retries and attempt information, so that durable background work behaves as expected.
13. As a developer, I want Durable Object identity, persistent storage and alarms, so that stateful services work locally and in the cloud.
14. As a developer, I want email bindings and captured local email, so that I can test notifications without sending real messages during local development.
15. As a developer, I want Access applications, policies and service tokens, so that protected environments keep the required access rules.
16. As a developer, I want custom domains, static assets and observability destinations, so that deployed applications use the required URLs and reporting setup.
17. As a developer, I want per-preview R2 buckets and scoped API tokens, so that temporary environments have their own storage.
18. As a developer, I want one command to run the application graph locally, so that I do not coordinate separate runtime processes myself.
19. As a developer, I want local startup without Cloudflare credentials or saved login profiles, so that a fresh checkout can run without cloud setup.
20. As a developer, I want hot reload and local data that survives restarts, so that I can make changes without repeatedly recreating test data.
21. As a developer, I want native R2 bindings and presigned HTTP requests to see the same local objects, so that uploads and downloads work across application paths.
22. As a developer, I want real native D1 batch behavior through the local proxy, so that transaction and result-order behavior is preserved.
23. As a developer, I want public test helpers for bindings, events, restart persistence and email capture, so that tests do not import Renkin internals.
24. As a developer, I want TanStack Start Solid SPA and SSR deployment, so that all three Delimoov frontends are supported.
25. As a developer, I want Astro static and server-rendered sites, so that Renkin supports both publishing models.
26. As a developer, I want Astro sessions and Worker bindings to follow the agreed Alchemy behavior, so that server-rendered sites retain those capabilities.
27. As a developer, I want correct monorepo build inputs, so that changing shared code or deployment settings does not reuse a stale build.
28. As a developer, I want unchanged sites to avoid unnecessary builds, so that a cron-only change does not rebuild unrelated websites.
29. As a developer, I want an optional external build command such as Moon, so that I can reuse my existing build tooling without making Moon mandatory.
30. As a developer, I want plain SQL and Delimoov's Drizzle migration format, so that I can remove the custom conversion code.
31. As a developer, I want migration execution to follow Alchemy's name-based history behavior, so that the rewrite does not impose a new migration policy.
32. As a developer, I want clear migration failures and retry behavior, so that I can understand what succeeded and what still needs attention.
33. As an operator, I want automatically configured cloud state shared by my machine and CI, so that deployments use the same ownership records.
34. As an operator, I want encrypted cloud state and private local state files, so that state storage follows the agreed handling of secret values.
35. As an operator, I want unreadable state to stop the operation, so that corrupted records are not treated as a fresh environment.
36. As an operator, I want interrupted resource operations to recover on a later run, so that a failed deployment does not require starting over.
37. As an operator, I want a competing deployment to fail clearly and a crashed deployment not to leave a permanent lock, so that environments are not changed concurrently or blocked forever.
38. As an operator, I want data resources protected from deletion and replacement by default, so that an ordinary code edit does not silently lose data.
39. As an operator, I want explicit resource settings to allow disposable preview cleanup, so that protection does not prevent intentional deletion.
40. As an operator, I want a protected plan rejected before any changes, so that an invalid destructive plan does not partly update the environment.
41. As an operator, I want an explicit logical-ID rename that keeps the same resource and data, so that reorganizing declarations does not recreate infrastructure.
42. As an operator, I want references to resources owned by another stack, so that preview applications can use the permanent review Worker without owning it.
43. As an automation author, I want public TypeScript state reads and clean JSON commands, so that scripts can list environments and read outputs without evaluating infrastructure code.
44. As an automation author, I want Renkin to create and delete named environments while my GitHub workflow handles PR events, so that infrastructure and workflow responsibilities stay clear.
45. As a package consumer, I want one installable package with working types, CLI and public entrypoints, so that I do not need private workspaces or the Alchemy fork.
46. As a maintainer, I want local checks, real Cloudflare checks and isolated package checks, so that release confidence does not depend only on emulation or workspace imports.
47. As a maintainer, I want Apache 2.0 licensing and accurate source notices, so that reused code has a traceable origin and the release carries its required attribution.

## Implementation Decisions

### Scope, ownership and dependencies

- The core module owns stacks, resource identity, dependency tracking, bindings, state, lifecycle and reconciliation. It stays independent of website frameworks.
- The Cloudflare SDK boundary uses Distilled as a direct external dependency. Cloudflare resource implementations use that boundary and the core engine.
- The runtime module owns Worker execution, native bindings, bundling and local emulation. The websites module composes builds and deployment with resources and runtime behavior, including public Vite integration.
- The testing module supplies shared local fixtures and application/resource helpers. Tests remain with their owning modules; shared test helpers are not production dependencies.
- The public Renkin package assembles the API and CLI. It is the only published package. Website and example applications validate supported public usage, including both Astro modes.
- Keep dependencies acyclic. Do not introduce a package per concept or bring unrelated upstream providers into scope.
- Effect remains a compatible peer dependency with matching development tooling. Do not ship a second bundled Effect runtime. Dependency ranges and lockfiles follow the repository policy.
- Select a Distilled release by verifying the required behavior and Effect compatibility. Do not assume that a public release matches the fork's local SDK checkout. Preserve the meaning of errors that drive resource recovery and existence checks.
- No dependencies on Alchemy, its scoped packages or aliases are allowed. Independent runtime and build dependencies are allowed when needed.
- Bun on macOS and Linux is the first-release runtime contract. Node may remain a tool dependency without becoming a supported Renkin runtime.

### Simple public API

- Using a resource establishes its binding and deployment dependency without a second list or matching layer declaration in client code.
- A resolved client can be used through an application adapter without repeated capture and provision of Renkin runtime setup. Native handles remain available.
- Define each Worker implementation once. Supply deployment settings separately, supporting both ordinary and Effect-based Workers.
- Support mutual Worker calls, typed service clients, named entrypoints and required cross-stack references. The ownership graph must not turn a reference into permission to delete the referenced resource.
- Exact syntax and the mechanism for discovering bindings are engineering choices. Validate them with small consumer examples and type checks before broad extraction. Do not preserve arbitrary runtime interception solely because the fork uses it.

### Resource lifecycle, protection and identity

- Plans must identify the intended resource changes. Normal confirmation and noninteractive approval follow Alchemy's command behavior.
- Protect D1, R2, KV, queues and dead-letter queues, Durable Objects, Workflows, and owning Workers whose removal would lose stored data. Protection applies to resource types even when currently empty.
- Protection covers both deletion and replacement. Retaining an old database while silently switching to a new empty one does not satisfy data preservation.
- Reject a plan that violates protection before making changes. Blocking deletion must preserve ownership records; it must not turn a resource into unmanaged infrastructure.
- Allow deletion through explicit resource settings. Disposable preview environments can enable this for automatic cleanup. Nonempty R2 additionally requires explicit permission to empty the bucket.
- Preserve Alchemy's option meanings: `--yes` skips confirmation; `--force` reruns otherwise unchanged resources. Neither bypasses protection. No extra per-operation destructive bypass or partial-plan mode is included.
- Keep retention distinct from deletion protection. Document the ownership effect of any retain operation rather than treating keeping a physical object as equivalent to continuing to manage it.
- Provide an explicit logical-ID rename within the same stack, environment and resource type. Preserve physical identity and data; do not infer renames from similar declarations.
- Recover interrupted resource operations on a later run, including partial replacement and binding setup. Data protection remains effective during recovery.
- Block competing changes to the same environment with a clear error rather than waiting. A crash must not leave a permanent lock. Independent environments can deploy concurrently while respecting shared-resource ownership.
- Resource recovery does not promise automatic reversal or repair of partially applied SQL migrations.

### State, authentication and automation

- Automatically provision the Cloudflare storage needed for deployed state. Developers and CI share that state; state infrastructure must not become an accidental casualty of preview cleanup.
- Encrypt cloud state. Keep local development state in ordinary files excluded from Git and readable only by the current user. Local state may contain secret values; redacted output is not encryption.
- Missing state and unreadable state are different. Authentication, decoding or decryption failures must produce errors rather than being interpreted as a new environment.
- Cloud deployment uses an API token and account ID. Local startup must not require those values, an existing profile or browser login.
- Provide a TypeScript API and clean JSON CLI results for listing environments and reading outputs without evaluating infrastructure declarations. Keep progress messages separate and preserve the intended handling of secret outputs without leaking them in logs or errors.
- Preview deletion uses exact state ownership. Resource-name patterns are not deletion authority. Permanent cross-stack resources must survive preview cleanup.
- Renkin manages named environments. The consumer owns GitHub PR events and cleanup scheduling.

### Required Cloudflare and local behavior

- Cover Workers, service bindings, cron schedules, D1, R2, KV, queues and dead-letter consumers, Workflows, Durable Objects, email, Access applications/policies/service tokens, scoped account tokens, observability destinations, domains and static assets used by the reference consumer.
- Preserve the consumer's queue batching/retry settings, Workflow task and attempt context, Durable Object storage/identity/alarms, raw binding access, and captured local email.
- The local command runs the required service and frontend graph with hot reload, migrations and persistent emulator data. Restarting must preserve stored data and resource identity where expected.
- The reference main graph contains five services and three frontends. The separate review and companion applications are not evidence that the main command starts every application in the wider Delimoov repository.
- Document cloud-only behavior. Local dummy configuration does not promise real third-party OAuth or complete local simulation of Cloudflare Access.
- Preserve native D1 batching through the platform proxy: prepared statements survive transport, results stay ordered, failing native batches preserve the expected rollback behavior, and cross-binding statement references are rejected.
- Preserve the fork's Access CORS and eager cookie settings across create, update, read and comparison. Omitted desired fields keep observed configuration; supplied CORS fields merge as in the reference. Observed provider results remain authoritative.

### Local R2 and presigned requests

- Provide the opt-in local S3 endpoint and its configuration/helper behavior. Application code remains responsible for signing URLs; this is not a new signing client library.
- Support presigned PUT, GET and HEAD, plus unsigned OPTIONS. Native bindings and HTTP requests share persisted objects with bucket isolation.
- Preserve required SigV4 query validation, expiry handling, encoded keys, HTTP/custom metadata, ETags, response overrides, single ranges and trusted dev/Vite URL forwarding. The reserved endpoint must precede SPA fallback without taking over normal application routes.
- Match the bounded reference behavior: expiry values from 1 to 604800 seconds; rejection of expired requests and signing timestamps more than 15 minutes ahead; expected error responses for invalid requests.
- Local S3 CORS follows the fork's permissive behavior and does not claim to enforce production bucket CORS. Document unsupported operations and upload options clearly.

### Database migrations

- Accept plain SQL without requiring Drizzle. Also read Delimoov's current Drizzle format: flat SQL files and its version-zero migration journal. Remove the need for consumer conversion code.
- Preserve migration SQL and names. Validate the journal's structure, ordering and agreement with its SQL files. Input validation is separate from validation of previously applied history.
- Match Alchemy's name-based history: an applied name is skipped even if its SQL changes. Removing an applied file does not undo it or erase its history. A renamed file ordinarily becomes a new migration and may fail against an existing schema.
- Preserve reference ordering for supported valid inputs. Capture ambiguous ordering cases in implementation validation rather than inventing stricter history rules.
- Apply pending migrations sequentially and stop at the first reported error. Earlier successful migrations remain applied and are skipped on retry. An empty migration directory does no migration work.
- Do not claim an all-deployment transaction or automatic rollback. Validate the actual D1 boundary for each migration and its history write. Surface any failure requiring manual repair clearly.
- Legacy Alchemy or Wrangler migration-history import is not required because the first deployment starts fresh.

### Frameworks and builds

- TanStack Start support targets Solid, including SPA output with a prerendered index and SSR output, app-specific roots/server entries, local ports and the correct asset fallback.
- Preserve required build-time environment values, compatibility settings, source-map/build hooks, custom domains and static assets. Client code must not need the current workaround for nested prerender preview builds.
- Support Astro static and SSR output following the public Alchemy integration. Static mode deploys assets without automatically provisioning cloud session KV. SSR supports Worker bindings and automatic session KV, with an existing-binding option and a way to disable automatic sessions.
- Preserve the reference page-generation behavior, including its workerd path. Do not promise that putting a D1/R2/KV resource in the public environment options grants access during production page generation: the high-level reference build does not do that.
- Skip unnecessary website builds, and reuse expensive build work within a deployment. Changes to relevant shared source, lockfiles, build configuration and build-time/stage inputs must invalidate reuse.
- Support an external build command such as Moon and a standalone path without Moon. The build result must have a supported interface rather than requiring consumers to import an internal builder.
- Do not cache away infrastructure deployment work. If an upload needs build files absent locally, build or restore them; an unchanged-deployment check is not an artifact-restoration cache.
- No separate shared remote artifact cache is included in Renkin.

### Packaging and licensing

- Ship one usable package containing the internal JavaScript and declarations required by its public API, Cloudflare, Vite and testing entrypoints and CLI.
- Consumers must not resolve unpublished private workspaces or Alchemy aliases. Preserve typed Effect requirements in emitted declarations.
- Use Apache 2.0. Before copying source, record its revision, review applicable licenses, retain relevant notices and mark modifications as required. Review inherited third-party notices for the selected files rather than importing unrelated implementation scope.
- The release build tool, declaration assembly and exact dependency versions remain bounded engineering choices. Validate the actual packed artifact before removing the scaffold publication guard.

## Testing Decisions

- **Main test boundary:** exercise Renkin through its supported TypeScript API, CLI and public testing helpers. This continues the confirmed local, real-Cloudflare and isolated-package validation approach. Prefer observable outcomes over internal graph shapes, call counts or a particular inference mechanism.
- **Local checks:** run without Cloudflare credentials, saved profiles or network access to the provider. Cover resource declarations, Worker calls in both directions, local events/bindings, persistent storage, migration behavior, presigned requests, framework builds, hot reload and CLI/API outputs. Check clean-machine startup explicitly; it was not established by source inspection of the fork.
- **Focused core tests:** use controlled failure and state boundaries where needed to prove recovery, protected-plan rejection before changes, ownership preservation, interrupted replacements, competing deployments, stale-lock recovery and logical-ID renames. Do not require cloud deployment to test every failure transition.
- **SDK and provider tests:** verify the error meanings, retry behavior and observed-resource handling used by the selected resources. Distilled compatibility must be tested rather than inferred from matching version numbers.
- **Migration tests:** cover plain SQL, the supported Drizzle journal, malformed input, ordering, fresh application, repeat application with data preserved, edited/deleted/renamed applied files, empty input and failures after earlier successes. Do not assert immutable-history enforcement or automatic rollback that the chosen policy does not provide.
- **Runtime regressions:** cover shared native/S3 objects, signatures/expiry, metadata/ranges, proxy URL handling, endpoint precedence, native D1 batch rollback and isolation, queues/dead-letter settings, Workflows, Durable Objects and captured email.
- **Framework checks:** build and exercise TanStack Solid SPA/SSR and Astro static/SSR through public entrypoints. Cover routing/fallback, server bindings, session options, monorepo invalidation, changed stage/build inputs, external build commands and missing local artifacts.
- **Real Cloudflare checks:** before release, run a separate credentialed suite against temporary resources. Verify required cloud-only behavior and cleanup, including Access settings, domains, cross-stack references, scoped preview ownership and lifecycle behavior. Cleanup must not remove permanent or foreign resources; report leftovers and failures clearly.
- **Installed-package checks:** pack the release, install it outside the monorepo, and verify imports, every supported entrypoint, declarations, Effect requirements, CLI and representative framework use under Bun on macOS/Linux. Inspect package contents and dependency metadata for private-package and Alchemy leaks.
- **Ownership and tooling:** tests stay with their owning modules, using the shared testing module only for reusable helpers. Use the repository's Effect test tooling and separate local unit/integration and real-cloud execution as appropriate. Do not treat zero-test or empty-project checks as behavioral evidence.
- **Prior art:** the Alchemy fork has R2 S3, D1 proxy and Astro integration regressions. Delimoov has migration, local binding, Durable Object restart, frontend build, deployment and preview-cleanup checks. Use their behavior as reference evidence, not a requirement to copy their internal test structure.
- The current Renkin scaffold has zero behavioral tests. Discovery inspected source and tests but did not run application tests or deploy anything. These are future acceptance checks, not reported passes.

## Out of Scope

- General Alchemy feature parity outside the selected consumer and framework behavior; other cloud providers and unrelated frameworks.
- Existing deployment takeover, Alchemy state import, legacy migration-history import and old local emulator-state migration.
- Node.js as a supported Renkin runtime and Windows support in the first release.
- Browser OAuth login, saved login profiles and global account-key authentication in the first release.
- Moving resource ownership between stacks or environments, inferred renames and resource-type changes through rename.
- Arbitrary circular dependencies between every possible resource type; mutual Worker calls are required.
- A new per-operation protection-bypass command, partial execution of a plan rejected by protection, or treating confirmation flags as deletion permission.
- Strict rejection of edited or missing applied migrations and automatic rollback/repair of partially executed SQL.
- Full S3 compatibility, including listing, DELETE and multipart operations, or a new application URL-signing library.
- Claiming local S3 validates production CORS or that every cloud-only service is fully emulated.
- Automatic high-level D1/R2/KV access during Astro production page generation beyond the reference behavior.
- A separate remote build-artifact cache and making Moon mandatory.
- GitHub PR-event handling and cleanup scheduling inside Renkin.
- Publishing multiple internal packages or copying Distilled into Renkin instead of using it as a dependency.
- An obligation to keep upstream internal designs when a simpler design meets the agreed behavior.

## Further Notes

- This spec synthesizes the confirmed discovery interview. It is the parent scope for the later ticket graph, not an instruction to implement the entire release in one change.
- Source baselines: Renkin `3b4ebc1ffcf2cc93096a273584d79ed61db01367`; Alchemy fork `82b7fc24c03db868772a60bb2927054582d22f43`; Delimoov `cb885863bb6b91901865700bb947c84742aae069`. The fork's inspected Distilled submodule was `71455a8c2e470cf8725eb7b333456edb9768ece0`.
- Current consumer observations are checked-in behavior, not proof of deployed infrastructure. The owner confirmed Delimoov has not been deployed. Older consumer documentation describing a Wrangler bridge or no cross-stack references is not the current source of truth.
- Later confirmed decisions replace earlier interview proposals: use external Distilled, support both Astro modes, target Bun only, preserve Alchemy migration history behavior, and keep deletion protection separate from CLI approval.
- Carry the confirmed architecture, glossary and accepted ADRs into implementation. The earlier SDK-copy ADR is superseded.
- Resolve concrete API shapes, state schema/encryption/locking mechanisms, release build and declarations, supported dependency versions, Astro SSR fixture placement and precise source notices through bounded engineering work. These choices must satisfy this spec rather than reopen the confirmed product scope.
- Review representative Delimoov authoring and test examples against the simple-API requirements before settling the implementation. Replacing duplicate runtime setup, dummy ordering bindings, migration conversion and internal build/test imports is part of the intended simplification.
