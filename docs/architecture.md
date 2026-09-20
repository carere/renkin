# Renkin architecture

Renkin is an Effect-based infrastructure toolkit for Cloudflare. This document
records the agreed ownership and future feature scope. The repository currently
contains tooling and workspace placeholders only; none of these capabilities is
implemented yet.

## Workspace ownership

| Workspace | Responsibility |
| --- | --- |
| `apps/website` | Astro marketing and documentation site. |
| `apps/example-spa` | TanStack Start with Solid, SPA example and validation app. |
| `apps/example-ssr` | TanStack Start with Solid, SSR example and validation app. |
| `apps/example-static` | Astro SSG example and validation app. |
| `packages/core` | Effect-based infrastructure engine: stacks, dependency graph, bindings, state, lifecycle and reconciliation. |
| `packages/cloudflare-sdk` | Boundary for Cloudflare HTTP clients and types. SDK sourcing is still open. |
| `packages/cloudflare` | Selected Cloudflare resources and capabilities, implemented using the SDK. |
| `packages/runtime` | Worker execution, native bindings, bundling and local emulation. |
| `packages/websites` | TanStack SPA/SSR and Astro SSG build/deployment integration, including public Vite integration. |
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
development dependency for tests. The foundation pins the same Effect release as
its test adapter. Its exact prerelease peer pin is deliberately conservative;
expand compatibility only after testing additional releases. Avoid bundling a
second Effect runtime into the public package.

## SDK sourcing: open decision

`packages/cloudflare-sdk` is the intended boundary for Cloudflare HTTP clients and
types. Vendoring selected Distilled code versus retaining Distilled as an external
dependency has **not** been resolved. Do not extract SDK code or add Distilled as
a dependency until that choice is made. Compare maintenance, updates, licensing,
error compatibility and release packaging when making the decision.

## Alchemy extraction

Renkin must have no dependencies on `alchemy`, `@alchemy.run/*`, or
`@carere/alchemy` packages, including aliases to them. Future implementation will
extract only the required Alchemy code, preserving behavior first and simplifying
later. Record its source revision and retain applicable attribution and license
notices for each extraction. Review those licenses before copying code. No
Alchemy implementation, history, or deployment configuration is included here.

## Initial future capability scope

Delimoov's current infrastructure defines the initial validation needs:

- Workers, service bindings and cron schedules.
- D1 and migrations; R2 with CORS and shared preview references; KV.
- Queues and dead-letter consumers, Workflows, Durable Objects and Email.
- Access applications, service tokens and policies; observability destinations.
- Vite websites, custom domains and static assets.
- Local runtime and testing, retention policies and cross-stack references.
- Local/cloud state, preview environments and build caching.

This list is future implementation scope, not a claim that the setup implements
or deploys any resources. The example apps should eventually exercise the SPA,
SSR and SSG paths; package tests should verify their owning behavior locally.

## Open decisions

- Distilled vendoring versus an external SDK dependency.
- Release bundler, declaration assembly and isolated consumer checks.
- Detailed engine, state, lifecycle and resource interfaces.
- Framework versions and integration contracts when the apps are implemented.
- Project license and required notices before any source extraction or release.
