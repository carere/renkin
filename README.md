# Renkin

An Effect-based infrastructure toolkit for Cloudflare. This repository currently
provides a Bun/Moon monorepo and an initial Worker deployment slice: ordinary and
Effect HTTP Workers, local hot reload, encrypted shared state, lifecycle recovery,
and JSON inspection APIs. See [Worker usage and validation](docs/worker-first-slice.md).
Protected D1 databases support typed and native bindings, persistent local storage,
and name-based SQL or Drizzle migrations. See [D1 usage and migrations](docs/d1-migrations.md).
Additional resources, framework integrations and the release artifact remain in
progress. See the
[architecture](docs/architecture.md) for the agreed workspace boundaries and open
decisions.

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
TypeScript checks the workspace-owned tool configurations. The Worker slice has behavioral unit, integration and separately invoked
credentialed Cloudflare tests. CI runs the populated local suites. Test tasks
remain strict and fail for empty suites; untouched apps and framework workspaces
still have no behavioral tests. Release artifact validation remains outstanding.

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
Add cache inputs, outputs and dependency ordering with future build tasks.

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
agent workflows. Apache 2.0 is the chosen project license; prepare its license
file and applicable third-party notices before importing source or publishing.

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

Versioning configuration does not complete the release build. Before publishing,
implement and validate the build and isolated consumer checks described in
[the architecture](docs/architecture.md), then replace the scaffold publish guard
with the actual release checks and add deployment automation.

References: [Cocogitto configuration](https://docs.cocogitto.io/reference/config.html)
[automatic versioning and hooks](https://docs.cocogitto.io/guide/bump.html),
and [Bun package versioning](https://bun.com/docs/pm/cli/pm#version).
