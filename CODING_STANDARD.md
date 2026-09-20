# Coding standard

## Ownership and imports

Read [the architecture](docs/architecture.md) before adding a workspace dependency
or changing a public interface. Keep implementation in the owning workspace's
`src/` and tests under its `tests/`. Organize by capability; Delimoov's business
contexts and frontend state conventions are not Renkin requirements.

Use TypeScript for source, tests, scripts and configuration where supported. Keep
strict compiler checks. Use relative imports for neighbors and workspace package
names across projects. Define project-local aliases with package `imports` when
needed instead of duplicating TypeScript and bundler mappings. Avoid internal
barrels; explicit public entry modules are appropriate for Renkin's published API.
Declare dependencies in the workspace that uses them.

## Effects and tests

Model infrastructure operations and typed failures with Effect. Keep pure graph
and state logic separate from HTTP, filesystem and runtime adapters. Verify
behavior through observable interfaces, preserving upstream behavior during
extraction before simplifying it.

Use Vitest and `@effect/vitest` for Effect tests. Keep unit and integration suites
separate. Unit tests replace external boundaries with small deterministic test
doubles. Integration tests exercise real adapters against local emulation where
available. Put fixtures and test doubles in the owning `tests/support/` directory.
Shared reusable Cloudflare test helpers belong in `packages/testing`; individual
tests stay with their owner. Add browser tests for real critical app flows when
apps exist. Never treat an empty scaffold test run as product validation.

## Tooling and changes

Use Bun workspaces and Moon project tasks. Root shortcuts and lifecycle hooks may
live in package scripts. Biome is the formatting, lint and import-order authority;
keep package manifests sorted. Follow Conventional Commits for commits and PR
titles. Run the relevant checks documented in README after changes.

Before copying external source, record its origin and revision, review the license
and preserve required notices. Never add Alchemy packages or package aliases.
Keep deployments, credentials and remote cache identities out of the foundation.
