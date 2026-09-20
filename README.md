# Renkin

An Effect-based infrastructure toolkit for Cloudflare. This repository currently
provides a Bun/Moon monorepo foundation; the engine, resources, runtime, SDK and
framework integrations have not been implemented. See the
[architecture](docs/architecture.md) for the agreed workspace boundaries and open
decisions.

## Getting started

Install Bun **1.4.2**, Node.js **24.21.0** and Cocogitto **6.5.0 or newer**.
The optional `.prototools` pins Bun and Node for proto users. Moon and all npm
tools are pinned development dependencies; invoke them with `bun`.

```sh
git clone git@github.com:carere/renkin.git
cd renkin
bun install --frozen-lockfile
bun run setup
bun run check
```

`prepare` enables Effect diagnostics in TypeScript. `setup` installs Lefthook's
Git hooks and synchronizes Moon's project configuration. Hooks check staged files
and Conventional Commit messages without rewriting or staging additional changes.
Use `bun run format` to apply formatting, import organization and manifest sorting.

## Checks

```sh
bun run check                         # Full foundation check through Moon
bun run typecheck                     # Strict TypeScript project references
bun run lint                          # Biome formatting, lint and import checks
bun knip                              # Unused files and dependencies
bun moon run core:typecheck core:lint # An individual workspace
bun run test                          # Strict test runner: fails if there are no tests
bun run test:scaffold                 # Explicitly allow the current empty test suite
cog check --ignore-merge-commits       # Commit history, once commits exist
```

The foundation check runs Biome, TypeScript, Knip, manifest sorting checks and the
explicit scaffold test command. TypeScript currently checks tooling configuration;
empty workspace configs reserve future source/test paths without fake modules.
Vitest separates unit and integration projects but currently discovers **zero
tests**. Once behavioral tests land, replace `test-scaffold` with `test` in the
root Moon check dependencies so missing tests fail CI. No application build,
resource tests, deployment or release validation exists yet.

Tests belong in `apps/<name>/tests/{unit,integration}` or
`packages/<name>/tests/{unit,integration}`, named `*.test.ts`. Run an individual
suite with `bun run test --project unit` or pass a test path to filter by owner.
Use `@effect/vitest` for Effect behavior. Add browser tooling when real application
flows exist. Read [CODING_STANDARD.md](CODING_STANDARD.md) before contributing.

## Workspace tooling

The setup adapts Delimoov's Bun, Moon, strict TypeScript, Effect diagnostics,
Biome, Vitest, Knip, Lefthook and Cocogitto conventions. Root scripts are shortcuts
for onboarding and checks; project tasks live in Moon. Moon uses local caching;
no remote cache service, credentials or deployment identity is configured.
Type checking and validation tasks run uncached so their results remain explicit.
Add cache inputs, outputs and dependency ordering with future build tasks.

Effect and `@effect/vitest` are pinned to **4.0.0-rc.115**, Vitest to **5.0.0**,
TypeScript to **7.0.2**, and `@effect/tsgo` to **0.45.0**, matching the inspected
reference. These are prerelease Effect versions, not a broad compatibility claim.
Root reservations establish the test toolchain; consuming workspaces must declare
their own runtime/test dependencies when implementation begins. Keep the lockfile
in version control and use frozen installs in CI.

GitHub Actions runs the same checks, verifies Conventional Commits and PR titles,
and checks for configuration drift. It needs no Cloudflare credentials. Review
[AGENTS.md](AGENTS.md) and the local [skill guide](docs/agent-skills.md) for agent
workflows. The repository has no chosen project license yet; settle that and
third-party notices before importing source or publishing.
