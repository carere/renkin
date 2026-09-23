# Package assembly and checks

The release task assembles one standalone ESM package from Renkin's seven private
implementation workspaces. It transpiles modules without bundling dependencies,
emits declarations, and rewrites module specifiers and package-relative `new URL`
assets using a syntax-aware parser. Host-only lazy framework modules stay lazy.
Effect is an external compatible peer and Distilled remains an external dependency.

From a source checkout:

```sh
moon run renkin:pack
moon run renkin:test-release
```

The stage is `.renkin/release/package`; the versioned tarball and `artifact.json`
record are beside it. `artifact.json` identifies the exact SHA-256, source revision,
dirty-checkout status, lockfile digest, Bun version and validated public subpaths.
The package includes `BUILD_INFO.json`, licenses/notices, JS/declarations, runtime
URL targets and usage guides. Consumer-generated assets, build snapshots, receipts,
source maps, state, tests, provider credentials and private package manifests are
not release inputs. The supported build/declaration choice is validated against the
actual tarball, not just a staging-directory import.

Ordinary `bun pm pack` from the source public workspace fails with an actionable
message. Source exports remain useful for workspace development and are never
rewritten temporarily. The maintained test proves this guard and verifies the
source manifest remains unchanged. `--ignore-scripts` deliberately bypasses lifecycle
scripts and is not a supported release path. No registry publication command is
part of these tasks.

## Installed-consumer checks

The harness installs the actual tarball into a fresh directory outside the
repository with no private workspace package resolution or manual dependency
symlinks. It inspects
archive entries and the installed transitive module/URL closure, verifies all eight
public declaration subpaths, host imports and shared Effect identity, CLI help and
read-only inspection, plus the application's negative Effect-requirement type tests.
Workerd-only Durable Object and Workflow imports run through the native graph.

All four maintained framework applications run from copied consumer sources using
installed `@carere/renkin`: Solid SPA/SSR, Astro static/SSR, browser hydration/navigation,
native bindings, Astro sessions, prerendering, build assets/source maps and development
reload. The five-service/three-frontend graph additionally exercises migrations,
queues/retry/DLQ, Workflows, captured email, schedules, DO SQL/alarms, persisted restart,
application-signed browser-origin S3 and stack isolation. Its process has provider
credentials removed, keyring/profile access disabled, and non-loopback networking
denied by macOS sandbox-exec or Linux's network namespace. A successful external TCP
control precedes the denied check; Linux drops back to the original uid/gid before
running Bun. Dependency installation happens before this network-denied phase.

The `Release artifact validation` workflow runs the same harness on macOS and Linux
and saves the tarball and identity record. The manual `Release` workflow supplies
one canonical tarball to both runners, then creates a draft GitHub release and
optionally publishes that exact artifact to npm. See [the release procedure](../releasing.md)
for bootstrap and trusted publishing. Real-cloud validation is a separate explicitly
scoped operation.
