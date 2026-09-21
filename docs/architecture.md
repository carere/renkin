# Renkin architecture

Renkin is an Effect-based infrastructure toolkit for Cloudflare. This document
records the agreed ownership and future feature scope. The repository currently
contains an initial Worker, lifecycle, state, SDK and runtime implementation.
See [the Worker slice](worker-first-slice.md) for current capabilities and limits;
remaining resources, frameworks and release packaging are subsequent work.

## Workspace ownership

| Workspace | Responsibility |
| --- | --- |
| `apps/website` | Astro marketing and documentation site. |
| `apps/example-spa` | TanStack Start with Solid, SPA example and validation app. |
| `apps/example-ssr` | TanStack Start with Solid, SSR example and validation app. |
| `apps/example-static` | Astro SSG example and validation app. |
| `packages/core` | Effect-based infrastructure engine: stacks, dependency graph, bindings, state, lifecycle and reconciliation. |
| `packages/cloudflare-sdk` | Boundary for Cloudflare HTTP clients and types, using Distilled as a dependency. |
| `packages/cloudflare` | Selected Cloudflare resources and capabilities, implemented using the SDK. |
| `packages/runtime` | Worker execution, native bindings, bundling and local emulation. |
| `packages/websites` | TanStack SPA/SSR and Astro static/SSR build/deployment integration, including public Vite integration. |
| `packages/testing` | Shared local Cloudflare, resource and application test helpers. Individual tests remain with their owning packages. |
| `packages/renkin` | The sole published package, exposing the public API and CLI. |

## Dependency direction

Core owns infrastructure semantics and stays independent of website frameworks.
Cloudflare resources use the core engine and the SDK boundary. Runtime owns
execution and emulation mechanics; websites composes build/deployment behavior
with the resource and runtime capabilities. Shared testing helpers support these
packages without becoming their production dependency. Renkin assembles their
public interfaces. Apps validate Renkin through its intended public entry points.
These are intended directions, not dependencies to add before implementation
needs them. Keep the graph acyclic and record concrete interface decisions as
they are made.

## One published package

The first release targets Bun on macOS and Linux. Node.js and Windows support
are deferred. Node may still be used by repository tools or build dependencies;
that does not make it a supported runtime for Renkin's public CLI.

Only `packages/renkin` is publishable. All other packages and apps are private.
Planned entry points include `renkin/cloudflare`, `renkin/vite` and
`renkin/testing`, alongside the root API and CLI. No exports point at nonexistent
files in this scaffold.

The eventual release build must include the internal JavaScript and TypeScript
declarations required by those entry points. Bundle or copy the internal code
and resolve or rewrite private workspace imports in both JavaScript and type
declarations. Consumers must never need an unpublished `@renkin/*` package.
Workspace source resolution is a development convenience, not release validation.

Before release, pack the actual artifact and install it into an isolated consumer
outside the monorepo and its workspace resolution. Verify runtime imports, every
public subpath, declaration resolution, the CLI, and representative Vite/framework
usage. Inspect the tarball and its dependency metadata for private package leaks.
The build approach and supported output formats remain open. Publishing is guarded
until that build and consumer validation exist.

Effect must be a compatible peer dependency of the published API, with a matching
development dependency for tests. The foundation uses matching caret ranges for Effect and
its test adapter, with exact resolutions recorded in the lockfile. The public
peer uses the same range; validate compatibility when updating prereleases. Avoid bundling a
second Effect runtime into the public package.

## SDK sourcing

`packages/cloudflare-sdk` uses Distilled as a direct external dependency and owns
Renkin's client setup and error handling at that boundary. Distilled is separate
from Alchemy; Alchemy package dependencies remain prohibited. Check the selected
release for the required resource behavior and Effect compatibility, including
errors used during deployment. See
[the SDK dependency decision](adr/0004-use-distilled-as-a-dependency.md).

## Alchemy compatibility and reuse

Renkin must have no dependencies on `alchemy`, `@alchemy.run/*`, or
`@carere/alchemy` packages, including aliases to them. Preserve required behavior,
but permit redesigned internals from the start when supported by evidence and
compatibility checks. Consumer declarations and imports may change, but Renkin's
public API must remain simple; internal simplification must not shift complexity
into client code. See [the compatibility decision](adr/0001-behavior-compatible-rewrite.md).

Reuse only required Alchemy code when appropriate. Record its source revision and
retain applicable attribution and license notices for each extraction. Review
those licenses before copying code. No
Alchemy implementation, history, or deployment configuration is included here.

Delimoov has not been deployed, so the first release may start with fresh resources
and state. Importing Alchemy state and taking over existing deployments are not
required; see [the fresh-start decision](adr/0002-start-with-fresh-infrastructure.md).

## User-facing requirements

- Using a resource establishes its binding and deployment dependency without
  duplicate configuration.
- Resource clients work in application code without repeatedly passing Renkin
  runtime setup objects. Native Cloudflare handles remain available.
- Each Worker implementation is defined once, with deployment options supplied
  separately. Workers must be able to call each other in both directions.
- Failed deployments can recover on a later run. Resources marked to be kept
  remain protected. Two deployments cannot change the same environment at once.
  A competing deployment stops with a clear message rather than waiting. A crash
  must not leave a permanent lock; different environments may deploy concurrently.
  If a coordinator crash leaves a provider mutation's outcome unknowable, require
  [explicit reconciliation](adr/0007-reconcile-ambiguous-provider-operations-explicitly.md)
  before allowing later mutations, as accepted for this exceptional case.
  Database migration failures can require user intervention; resource recovery
  is not a promise to reverse or repair partially applied SQL automatically.
- One command runs the required application graph locally without Cloudflare
  credentials, with hot reload and data kept between restarts. This includes
  queues, Workflows, Durable Objects, captured email and local presigned R2 URLs.
  Explain any behavior that can only be checked in the cloud.
- Renkin automatically sets up Cloudflare storage for deployed state. Local
  development state stays on disk. Developers and CI use the same deployed state.
  Cloud state is encrypted. Local state uses ordinary files excluded from Git and
  readable only by the current user. Unreadable state is an error, not empty state.
- Renkin creates and deletes named environments. The consuming project's GitHub
  workflows handle PR events and decide when to clean up preview environments.
- Renkin accepts plain SQL migrations and reads Drizzle's migration format,
  replacing the conversion code currently maintained in Delimoov. Drizzle is not
  required for consumers that use plain SQL.
  Match Alchemy's migration history behavior: skip already-applied names rather
  than rejecting changes to their SQL. Exact input and failure rules must be
  captured from the reference implementation.
- Block deletion of resources holding data unless deletion is explicitly enabled.
  Disposable preview environments can enable deletion for automatic cleanup.
  Protection applies to D1, R2, KV, queues, Durable Objects, Workflows and owning
  Workers whose removal would lose stored data, even when currently empty. It
  also blocks replacement with a new resource. Reject a plan that violates this
  protection before making changes. Follow Alchemy's option meanings: `--yes`
  skips confirmation, `--force` reruns unchanged resources, and explicit resource
  settings allow deletion. Neither CLI flag bypasses data protection. Keep the
  explicit opt-in to empty and delete nonempty R2 buckets.
  Preserve the existing resource and its data through an explicit logical-ID
  rename operation within the same stack and environment and for the same
  resource type. Do not infer renames from similar declarations. Moving ownership
  between stacks or environments is deferred.
- Provide a TypeScript API and clean JSON CLI output to list environments and
  read outputs without evaluating infrastructure code. Progress output stays
  separate from JSON.
- Independent tools such as Effect, workerd, Miniflare, Vite and Astro may remain
  dependencies. This does not require retaining every tool used by Alchemy.
- Cloud deployment uses a Cloudflare API token and account ID. Browser login,
  saved login profiles and global account keys are outside the first-release
  scope. Local development needs no Cloudflare login.
- Renkin skips unnecessary website builds and reuses build work within a
  deployment. It can invoke an external build command such as Moon, but also
  works without Moon. Do not add a separate remote artifact cache. If a deployment
  needs absent build files, build or restore them before upload; cached build
  results must never skip infrastructure changes that still need to run.

## License

Renkin will use Apache 2.0. Retain applicable third-party licenses and notices for
copied code, record its source revision, and mark modifications as required.
License selection does not complete the per-file review or release notices.

## Release validation

Normal development checks run locally without Cloudflare credentials. Before
release, a separate real-Cloudflare suite creates temporary resources, checks
the required behavior and cleans up. These checks complement the isolated
package installation checks above; neither local emulation nor source inspection
alone proves cloud compatibility.

## Initial future capability scope

The initial scope is Delimoov's actual requirements plus TanStack Start with
Solid SPA/SSR and Astro static/SSR validation, including the local fork's added behavior.
It does not cover every Alchemy feature within those technologies. The initial
validation needs are:

- Workers, service bindings and cron schedules.
- D1 and migrations; native D1 batch through the local platform proxy; KV.
- R2 with CORS, per-preview buckets and scoped API tokens, and local S3/presigned
  URL interoperability with native bindings.
- Queues and dead-letter consumers, Workflows, Durable Objects and Email.
- Access applications, service tokens and policies, including the fork's CORS
  and eager cookie settings; observability destinations.
- Vite websites, custom domains and static assets.
- Local runtime and testing, retention policies and cross-stack references,
  including Delimoov's permanent review Worker.
- Local/cloud state, preview environments and build caching.

This list is future implementation scope, not a claim that the setup implements
or deploys any resources. The example apps should eventually exercise the SPA,
SSR and SSG paths, including Astro server rendering; package tests should verify
their owning behavior locally. `apps/example-static` exercises Astro static output,
and `apps/website` is the runnable Astro SSR fixture with native bindings and sessions.

## Open decisions

- Release bundler, declaration assembly and isolated consumer checks.
- Detailed engine, state, lifecycle and resource interfaces.
- Framework versions and integration contracts when the apps are implemented.
- Required source and third-party notices before any extraction or release.
