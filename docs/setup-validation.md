# Foundation validation

Validated locally on 2026-09-20 with Bun 1.4.2, Node 24.21.0 and Cocogitto 7.0.0.

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass; the Effect compiler patch is idempotent. |
| `bun run setup` | Pass; Git hooks installed and all 12 Moon projects synchronized. |
| `bun run check` | Pass; Biome, TypeScript, Knip, manifest sorting and explicit scaffold test task. |
| `bun moon run core:typecheck core:lint` | Pass; inherited workspace tasks work. |
| Lefthook checks of root and nested manifests | Pass; both locations are included. |
| Conventional Commit hook and `cog check --ignore-merge-commits` | Pass. |
| `bun run test` | Expected failure: no tests exist yet. |
| `bun run --cwd packages/renkin prepublishOnly` | Expected failure: unfinished release is guarded. |
| Manifest and lockfile inspection | No Alchemy dependencies or aliases; only Renkin is publishable. |

TypeScript validates tool configuration; package projects have no implementation.
The scaffold test task reports zero tests and explicitly permits that condition.
No build, Cloudflare deployment, product behavior or isolated release consumer is
validated. The GitHub Actions workflow is configured but has not run remotely.

Moon requires a Git HEAD, so the empty repository received an initial local
Conventional Commit before Moon validation. Origin is `git@github.com:carere/renkin.git`;
no commits were pushed. Delimoov was inspected read-only.

The root Moon project preserves its explicit all-workspace TypeScript references.
Individual projects can still synchronize references from their actual dependency
graph when implementation introduces dependencies.
