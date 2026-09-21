# Release artifact validation

The release task assembles one standalone ESM package from Renkin's seven private
implementation workspaces. It transpiles modules without bundling dependencies,
emits declarations, and rewrites module specifiers and package-relative `new URL`
assets using a syntax-aware parser. Host-only lazy framework modules stay lazy.
Effect is an external compatible peer and Distilled remains an external dependency.

From a source checkout:

```sh
bun moon run renkin:pack
bun moon run renkin:test-release
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

## Maintained installed-consumer checks

The harness installs the actual tarball into a fresh directory outside the
repository with no workspace aliases or manual dependency symlinks. It inspects
archive entries and the installed transitive module/URL closure, verifies all eight
public declaration subpaths, host imports and shared Effect identity, CLI help and
read-only inspection, plus the application's negative Effect-requirement type tests.
Workerd-only Durable Object and Workflow imports run through the native graph.

All four maintained framework applications run from copied consumer sources using
installed `renkin`: Solid SPA/SSR, Astro static/SSR, browser hydration/navigation,
native bindings, Astro sessions, prerendering, build assets/source maps and development
reload. The five-service/three-frontend graph additionally exercises migrations,
queues/retry/DLQ, Workflows, captured email, schedules, DO SQL/alarms, persisted restart,
application-signed browser-origin S3 and stack isolation. Its process has provider
credentials removed, keyring/profile access disabled, and non-loopback networking
denied by macOS sandbox-exec or Linux's network namespace. A successful external TCP
control precedes the denied check; Linux drops back to the original uid/gid before
running Bun. Dependency installation happens before this network-denied phase.

The `Release artifact validation` workflow runs the same harness on macOS and Linux
and saves the tarball and identity record. It contains no provider credentials and
no publishing step. Real-cloud validation is a separate explicitly scoped operation.

## Initial observed results

On 2026-09-21, Bun 1.4.2 on macOS arm64 passed the maintained artifact test in 27.73s:
four actual framework suites each passed, and the complete native/browser graph
passed under OS-enforced network denial. Static TypeScript, Biome, Knip and manifest
sorting checks also passed. This first artifact contained 332 files and 515 checked
relative module/URL references, with SHA-256
`4da125b163313e1ad00a87e54d4790418845b5525c11ec602289c35f9703af63`.
It was built from `3a1b1ea` plus the explicitly recorded dirty release changes;
it is preliminary evidence, not the final clean release identity.

Fresh dependency resolution selected Effect `4.0.0-rc.117` within the declared peer
range. The installed application and all subpath types pass with the repository's
`skipLibCheck: true`. Strict root/Worker/testing declaration checks also pass.
Astro's upstream declaration closure under TypeScript 7.0.2 produces 57 diagnostics
(missing optional driver declarations and old TypeScript type names); importing
Astro directly produces the exact same 57 diagnostics. Renkin introduces zero
additional diagnostics. The public typed Astro configuration is preserved rather
than weakened or padded with unrelated optional drivers.

Cold installed graph validation uncovered optimizer metadata shared between sites
and late Router/Query dependency discovery before browser hydration. Development
uses canonical per-site optimizer paths; the plugin prediscovers known Router
transitives and the application declares its Query dependency. SSR controls become
interactive after hydration. Maintained checks use neither stale-module suppression
nor browser reload retries. Two narrow cold network-denied probes and the complete
maintained artifact test passed after those changes.

Linux CI and the accumulated installed real-cloud suite are pending at this
checkpoint. Source-workspace cloud results are not claimed as installed-artifact
results. The scaffold publication warning remains until release acceptance finishes.

The merged candidate's extended macOS harness passed in 34.39s, including an actual
installed Moon → Bun → `buildAstro` nested command, reuse of its result, recovery of
a deleted command manifest, and Solid build-snapshot invalidation after deleting a
captured source map. The standalone Moon fixture initializes its own empty Git
repository; it has no link to the source checkout's repository or dependencies.

To recheck an already validated CI tarball without repacking, set
`RENKIN_RELEASE_ARCHIVE` to its absolute path before running the maintained release
test. Its adjacent `artifact.json` must match the tarball digest and record a clean
source revision. This permits the Linux-produced bytes to be checked on macOS and
used unchanged for the later cloud suite. Per-OS preliminary builds have separate
identities and are not represented as the same artifact.
