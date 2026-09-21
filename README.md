# Renkin

An Effect-based infrastructure toolkit for Cloudflare. This repository currently
provides a Bun/Moon monorepo and a Worker deployment toolkit: ordinary and
Effect HTTP Workers, local hot reload, encrypted shared state, lifecycle recovery,
and JSON inspection APIs. See [Worker usage and validation](docs/worker-first-slice.md).
Protected D1 databases support typed and native bindings, persistent local storage,
and name-based SQL or Drizzle migrations. See [D1 usage and migrations](docs/d1-migrations.md).
Connected Workers now support typed/native KV, mutual service bindings, protected
storage and explicit renames; see [connected Worker usage](docs/connected-workers.md).
Assets, custom domains and Access controls are covered in [site usage](docs/sites-and-access.md).
Native SQLite Durable Objects, alarms and restart fixtures are covered in
[Durable Object usage](docs/durable-objects.md).
R2 buckets, opt-in local presigned uploads and scoped preview credentials are described in
[R2 and preview usage](docs/r2-and-previews.md).
Native cron handlers, queues, durable Workflows and captured email support background
jobs; see [background jobs and validation](docs/background-jobs.md).
Astro static and server-rendered sites include native bindings and protected sessions;
see [Astro usage](docs/astro-sites.md).
TanStack Start Solid SPA/SSR builds, native development bindings and runnable
examples are described in [TanStack sites](docs/tanstack-sites.md).
Validated local artifact reuse and external Moon/Bun build commands are described
in [Build reuse](docs/build-reuse.md).
The standalone release candidate, installed-consumer checks and validation status
are described in [release validation](docs/release-validation.md). See the
[architecture](docs/architecture.md) for workspace ownership and deliberate limits.

## Getting started

Use the latest stable Bun, the latest Node.js LTS, and Cocogitto **6.5.0 or newer**.
`.prototools` selects `bun = "latest"` and `node = "lts"`; Moon inherits both.
CI uses the same aliases and checks for the newest LTS release. Run `proto install`
to refresh locally managed runtimes. Runtime aliases can advance across majors.
Moon and npm tools are development dependencies; invoke them with `bun`.

```sh
git clone git@github.com:carere/renkin.git
cd renkin
bun install --frozen-lockfile
bun lefthook install
bun moon sync
bun tsc --build
bun biome check .
bun knip
bun sort-package-json --check package.json apps/*/package.json packages/*/package.json
```

`prepare` enables Effect diagnostics in TypeScript. `bun lefthook install` installs
Git hooks; `bun moon sync` synchronizes workspace configuration. Hooks check staged files
and Conventional Commit messages without rewriting or staging additional changes.
Use `bun biome check --write .` for formatting and import organization, and
`bun sort-package-json package.json apps/*/package.json packages/*/package.json`
for manifest sorting.

## Checks

```sh
bun tsc --build                       # Strict TypeScript project references
bun biome check .                     # Biome formatting, lint and import checks
bun sort-package-json --check package.json apps/*/package.json packages/*/package.json
bun knip                              # Unused files and dependencies
bun moon run core:typecheck core:lint # An individual workspace
bun moon run :test-unit               # Unit tasks across all workspaces
bun moon run :test-integration        # Integration tasks across all workspaces
bun moon run core:test-unit           # One workspace suite
cog check --ignore-merge-commits       # Commit history, once commits exist
```

Foundation validation runs Biome, TypeScript, Knip and manifest sorting directly.
TypeScript checks the workspace-owned tool configurations. Populated behavioral
suites cover resources, runtime, frameworks, example apps and the full local graph;
credentialed Cloudflare suites run separately. Empty test projects remain strict.
Standalone artifact validation passed on Linux and macOS, and installed Cloudflare
acceptance is complete across the documented release candidates. Source CI passed
227 behavioral tests after the startup and state fixes; see
[release validation](docs/release-validation.md) for exact provenance and limits.

Each workspace owns its `vitest.config.ts` and its Moon test tasks. Its initial
unit and integration projects discover local `tests/unit/**/*.test.ts` and
`tests/integration/**/*.test.ts`; the owner can change discovery, environments
and setup independently. Moon aggregates matching tasks with `:test-unit`,
`:test-integration`, or any future `:test-xxx` name. Add other suites only where
needed. Use `@effect/vitest` for Effect behavior and add browser tooling when real
application flows exist. Read [CODING_STANDARD.md](CODING_STANDARD.md) before
contributing.

## Workspace tooling

The setup adapts Delimoov's Bun, Moon, strict TypeScript, Effect diagnostics,
Biome, Vitest, Knip, Lefthook and Cocogitto conventions. Only the required prepare
hook lives in root package scripts. Repository checks run directly; Moon tasks
belong to apps and packages, with shared defaults in `.moon/tasks/`. There is no
root Moon project. Moon uses local caching
and the shared Remoshu HTTP cache at `https://remoshu.carere.workers.dev`, with
Renkin artifacts isolated under `carere/renkin`. Cache integrity verification is enabled.
Repository checks run directly, outside Moon caching.
Configure application build inputs and external command ordering through the
[build reuse API](docs/build-reuse.md); workspace Moon task definitions remain explicit.

Dependencies use caret (`^`) ranges. `bun.lock` records the exact resolved versions;
`bun install --frozen-lockfile` keeps CI reproducible. Run `bun update` to select
newer compatible versions, review the lockfile, and rerun checks. Caret ranges
normally permit minor and patch updates; for `0.x` releases they stop at the next
minor. Effect is currently a prerelease: update Effect and `@effect/vitest`
together and validate compatibility before broadening their ranges.

The published Effect peer uses the same caret range as development tooling.
Consuming workspaces declare their own dependencies. Runtime selection lives in
`.prototools` and CI rather than an exact `packageManager` pin; Moon's automatic
synchronization of that field is disabled.

GitHub Actions runs the same checks, verifies Conventional Commits and PR titles,
and checks for configuration drift. It needs no Cloudflare credentials. Review
[AGENTS.md](AGENTS.md) and the individual `.agents/skills/*/SKILL.md` files for
agent workflows. Apache 2.0 licensing, source provenance and external dependency notices are present
in LICENSE, NOTICE, SOURCE_PROVENANCE.md and THIRD_PARTY_NOTICES.md.

## Remote cache credentials

Set `MOON_REMOTE_CACHE_TOKEN` in the ignored root `.env` file; `.env.example`
contains the variable name only. The documented `bun moon` and `bun run` commands
load `.env` automatically. When invoking `moon` directly, export the variable in
your shell first. Never commit the token.

CI reads the GitHub Actions secret `MOON_REMOTE_CACHE_TOKEN`; configure that secret
for `carere/renkin` to enable authenticated cache access. A local `.env` is not
uploaded to GitHub. Cacheable project tasks can reuse remote results; repository checks run directly.

## Versioning and changelog

[`cog.toml`](cog.toml) configures one repository-wide release version for the sole
published `renkin` package. Commits across private packages also affect that
version; private workspaces do not receive independent release tags. Releases
use `v`-prefixed tags and a root `CHANGELOG.md` with GitHub links.

```sh
cog check                          # Validate the complete Conventional Commit history
cog changelog                      # Preview release notes without writing files
cog bump --auto --dry-run           # Preview the next version from committed changes
```

Once a release is ready, run `cog bump --auto` on a clean `main` checkout. The
pre-bump hooks validate commits, update `packages/renkin/package.json` with
`bun pm --cwd packages/renkin version <version> --no-git-tag-version`, refresh
`bun.lock` without install scripts, and stage both files. Cocogitto then writes the changelog,
creates the version commit and adds its tag. Other package versions stay private
and unchanged. No push, publication or deployment is triggered by these hooks.

As in Zaidan, `build`, `chore`, `perf`, `refactor`, `revert` and `style` commits
trigger patch bumps, alongside the default `fix` rule. `feat` triggers minor
bumps, and breaking changes affect the next version. Handwritten `merge:` commits
are accepted and omitted from release notes. Before 1.0, automatic bumps stay
below 1.0; choose the first stable release explicitly. Dry runs do not execute
bump hooks.

Versioning does not publish a package. Build the standalone artifact with
`bun moon run renkin:pack` and inspect its identity and the completed checks in
[release validation](docs/release-validation.md). Source-workspace packing remains
guarded; only the staged tarball is an intended distribution artifact. Registry
publication requires separate authorization and is not part of validation.

References: [Cocogitto configuration](https://docs.cocogitto.io/reference/config.html)
[automatic versioning and hooks](https://docs.cocogitto.io/guide/bump.html),
and [Bun package versioning](https://bun.com/docs/pm/cli/pm#version).
