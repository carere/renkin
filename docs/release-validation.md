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

## Completed cloud acceptance and accepted artifact

The accepted Linux-produced cloud-validation tarball has SHA-256
`21873a56d9bd8af088085d90670e91f1595aceb1bf78d70de0d973682ed2eff4`.
It records clean PR merge `02ae0d8a52b41a70f3fb1e2a82814c79aa7c4081`
(parent `593aebc`), Bun 1.4.2 and lock digest
`118e4e1c89bd51573ef2e39ec3e43bbf91ebb1f5b4857f5bd54bf06587193fb3`.
Its inventory contains 341 files and 522 checked relative references.
[Release CI](https://github.com/carere/renkin/actions/runs/35656934871) passed
on Ubuntu 24.04 and macOS 15. The exact Linux bytes also passed the full local
macOS installed-consumer harness in 39.47 seconds without repacking.
[Source CI](https://github.com/carere/renkin/actions/runs/35658651597) at `2909af0` passed
231 tests across 15 populated tasks and all static checks, including four offline
cloud-harness preparation tests.

| Candidate | Actual Cloudflare evidence |
| --- | --- |
| Earlier `ad218c…` archive | Twelve complete suites / thirteen cases: Worker, connected services, D1, background execution, DO lifecycle/recovery/retirement, R2, protected site, Astro, TanStack SPA/SSR and state authorization. The full graph additionally passed native flow and its accepted email before failing later state operations; that whole run was not green. |
| State fix `da7c8c3` | Maintained uninstrumented pressure regression: twenty 20 MiB write/read/lease cycles passed in 53.58 seconds, with exact disposable backend and namespace cleanup. |
| Final `21873a…` archive | Installed graph reuse-only test passed in 389.30 seconds: three frontend compilations remained three after the provider-observed cron change, and Tracking retained its physical identity. No application-flow or email request ran. |

The final graph scope was `renkin-test-graph-a153800d/full-graph`, with a fresh
`renkin-test-graph-a153800d-state` backend built from the installed archive.
All seventeen application resources and the environment were removed before the
owned backend was deleted; its Worker and namespace absence were verified. The
canonical shared backend was not upgraded. Earlier failed application and diagnostic
scopes were recovered and cleaned, as recorded below. Cleanup evidence combines
maintained public removal/index checks with targeted backend, token and domain
checks; it is not an independent physical GET audit of every resource.

Four test emails were accepted across the overall implementation and confirmed
received by the user. They were not repeated for the state fix. This is combined
acceptance evidence across two archives, not a claim that every cloud case ran on
one binary. The final changes preserve the encrypted state format and authenticated
context; native base64 conversion reduces temporary allocation pressure. The exact
provider admission mechanism behind the earlier repeated-state stall remains
unproven, while the repeated production regression and final graph now pass.

The scaffold publication warning has been removed. The source-workspace `prepack`
guard remains: distribute only the staged standalone artifact. No registry
publication was performed. Upstream declaration and guarded framework transport
compatibility limits described below still apply.

## Standards review candidate, September 22, 2026

The five final standards findings are addressed: request-scoped SSR runtime/query
composition, project-local imports with release rewriting, service-owned entry
implementations, mirrored test paths and a configurable state-removal test double.
Local serial source validation passed **236 tests across 90 files and 16 populated
tasks**, including four offline cloud-harness preparation cases. TypeScript, Biome,
Knip and manifest sorting passed. The SSR unit task is included in serial source CI.

The first standards candidate, `fc479f2`, failed installed SSR hydration because
late Query-core discovery invalidated browser dependency hashes. The application
now explicitly prediscovers that dependency, matching the maintained graph fixtures.
Three fresh-cache installed SSR repetitions and the strengthened browser assertion
against failed HTTP responses passed after the fix; no retries or stale-module
suppression were introduced.

Clean revision `8efb21e1e8720c47dc84b094ab2d993aa332028b` produced macOS archive
`f8e298da543af484303f251f7e23560eb6822abab64ae67d923125d8dc74799c`, using Bun 1.4.2
and lock digest `0301d2f7efd280ee3c74b9106be5025079f5257b00ea8fe0fa6a3281e5f7bbd0`.
Its full installed-consumer harness passed in 35.34 seconds: package and declaration
checks, all four framework apps, the native full graph, restored builds and Moon/Bun
build nesting. The artifact retains 341 files, 522 checked relative references and
the same eight public subpaths. This is local validation of the standards candidate;
actual Cloudflare acceptance remains the separate multi-candidate record above.
No provider calls, emails or publication were performed for these review fixes.

### Hosted cold-start follow-up

Hosted Linux and macOS artifact jobs for merge `5cecbdc` subsequently failed the
first development SSR request with a poisoned native binding; source CI passed.
Vite optimizer writes were inside the forwarding Worker's recursively watched
parent directory and triggered a runtime reload during that request. Revision
`2d0b93ae1eed8efebc900db1a93bcb3125625d0a` isolates the Worker artifact from the
optimizer directory. A real Vite/Miniflare regression reproduced the exact error
before the change and now passes, including a positive check that Worker edits
still reload. Four affected source suites passed 14 tests, and static checks passed.
Its clean local macOS archive
`a7e06b38d203d095049969622b82da32310ed985e55de08bf0400aa551224468` passed the full
installed-consumer harness in 36.11 seconds. Hosted revalidation is pending for this
follow-up; it did not repeat Cloudflare acceptance or send email.

## Maintained installed-consumer checks

The harness installs the actual tarball into a fresh directory outside the
repository with no private workspace package resolution or manual dependency
symlinks. It inspects
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

Linux and hosted macOS artifact validation now pass (see the final candidate below).
Installed cloud acceptance is complete across the candidates recorded below.
The chronological evidence retains earlier failures and their cleanup; the final
state-fix candidate completes the graph assertions without repeating accepted emails.

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

## Earlier candidate artifact

Release CI `35635021012` passed on Ubuntu 24.04 and hosted macOS 15 arm64. The exact
Linux archive also passed the full local macOS arm64 harness in 37.35s without
repacking. Its SHA-256 is
`ad218c4191b3f24e6f1c0ef9e1572f07cdcc7662ba5beedbd0c5843aec5d54fb`,
with clean PR merge source `b1c8a00709f2d7149cb75b0b35a30023ae505465` and
Bun 1.4.2. It contains 337 files and 518 checked relative module/URL references.
The adjacent artifact record retains the source lock digest; consumer dependency
resolution is separately tested rather than assumed equal to that source lock.

Hosted macOS exposed the official prerenderer's dependence on an HTTP dispatcher
that Bun's built-in undici replacement ignores. The scoped compatibility bridge
and its explicit verified-version boundary are documented in [Astro sites](astro-sites.md#bun-build-transport-compatibility).
Real workerd tests demonstrate both the corrected dispatcher path and the native
shim's missing dispatcher support. Failed prerender responses now abort builds.
The provisional plugin-minor constraint did not fix this failure and was reverted.

Supported installations should retain their package-manager lockfile after the
validated installation. The public caret ranges permit future dependency releases;
a new, unverified Miniflare 5 build intentionally requires compatibility validation
before the guarded build transport accepts it. No registry publication has occurred.

Source Checks CI `35635021057` passed all static checks and 219 behavioral tests
across 14 populated suites. These source results are recorded separately from the
installed-artifact and cloud results.

## Initial installed cloud validation, September 21, 2026

The exact final archive above was installed outside the source checkout and used
unchanged for these provider tests. Nine complete suites passed: Worker, connected
Workers, D1, Durable Object lifecycle, recovery and retirement, R2, restricted-token
state authorization, and Astro. TanStack's SPA case also passed. Thus **10 of the
12 selected non-email cases passed**, across nine complete suites and one partial
suite. No installed cloud email was sent; background and full-graph suites were
explicitly excluded while approval of their two messages remains pending.

Protected-site and TanStack SSR reached their custom-host readiness limits. Their
normal TLS checks were retained. Protected-site reported
`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`; SSR reported a network `TypeError`.
Both completed cleanup. Astro's live hostname independently showed a shared
advanced certificate pack in `pending_validation` and a TLS handshake with no
peer certificate; it subsequently became ready and passed within the original
bound. This demonstrates transient issuance during this run, but does not prove
the precise earlier certificate state of either failed hostname. No TLS bypass,
readiness extension, shared-certificate deletion, or further hostname allocation
was used to turn those failures into passes.

Two test-only corrections preceded successful reruns. Worker cleanup now expects
`readOutputs` to return `undefined` after the environment is removed. The public
state authorization observer now starts before Effect caches its default fetch
service, so it observes the exact restricted bearer rather than accepting a generic
public error. Both restricted permission types passed their authorized read controls,
direct state rejection and observed provider permission denial. Every temporary
token created by that suite was revoked in `finally`.

Cleanup evidence is deliberately narrower than an independent GET of every
physical resource. Maintained cleanup completed for every started scenario;
installed public reads additionally verified environment/index and output absence
for the following exact scopes (all names start with `renkin-test-`):

| Stack suffix | Environments |
| --- | --- |
| `e803dec0`, `c7a8fefe` | `smoke` |
| `e322d83d`, `e322d83d-permanent` | `graph` |
| `d1-e4c42bec` | `migration` |
| `do-c9255534`, `do-9d742417`, `do-a5c6a39d` | `objects` |
| `r2-ef98c518` | `preview-a`, `preview-b` |
| `astro-e6817058` | `preview` |
| `spa-e819df97`, `ssr-326f06dd` | `framework` |

The protected-site's three environments were removed before its isolated backend
`renkin-test-site-fef366d3-state-76129b` was removed. Independent provider inspection
confirmed that backend and its Durable Object namespace absent, with the canonical
`renkin-test-state-v2` still present. No custom-domain associations or retained
certificate packs matched the exact `site-fef366d3`, `astro-e6817058`, or
`ssr-326f06dd` hostnames under the authorized test domain. Temporary certificate-read
tokens were revoked. No independent physical-ID inventory of every other resource
is claimed.

## Historical validation and blockers (superseded)

This section records intermediate candidates and failures before the completed
acceptance above. Its former blockers are resolved; the chronology does not
change the candidate-specific cloud evidence.

The user subsequently approved the two exact email payloads and destinations.
Background `renkin-test-jobs-7c6919bf/background` passed and cleaned up. The original
full graph `renkin-test-graph-9fa869f0/full-graph` passed its native flow and accepted
its one order email, then failed during the cron-only deployment with cloud state
unavailable. Both messages were accepted once; the shared project count became
4/20. Neither send was repeated.

Protected-site `renkin-test-site-35047f19` and TanStack SSR
`renkin-test-ssr-794253e6/framework` passed with a bounded 15-minute custom-domain
readiness window and normal TLS/content checks. Live inspections showed shared
certificate packs pending validation with no returned validation errors. Their
cleanup and final domain/certificate/backend audits passed; temporary inspection
tokens were revoked and the canonical backend was preserved. The already-passed
SPA case was deliberately skipped in the SSR retry.

A distinct reuse-only graph run, `renkin-test-graph-cbc3e382/full-graph`, omitted all
application-flow requests and emails while retaining the original compilation,
cron and Worker-identity assertions. It failed during initial deployment with the
same cloud-state error. The first failed graph checkpoint was 21,298,604 bytes,
pending Storefront bindings; the second was 15,010,028 bytes, pending Auth bindings.
Both were subsequently readable with no active lease or uncertain provider
operation. The first was recovered and removed through the installed public API,
with environment/output absence verified. The second recovery initially failed too,
but later completed through the installed public API after bounded diagnostics;
`renkin-test-graph-cbc3e382/full-graph` now has verified environment/output absence.
A temporary diagnostic tail was removed. The canonical backend's code, secrets,
namespace and ownership state were preserved. These failures alone did not
establish a provider state-size limit.

At this intermediate checkpoint, twelve complete installed suites (13 test cases)
had passed. Full-graph acceptance was incomplete: its native flow passed, but the cron-only deployment return,
unchanged compilation count of three, changed cron and stable Tracking Worker ID
still needed proof. The failed graph runs were not counted as passing suites. The
canonical archive remained unchanged; no additional email was needed for these checks.
Later source Checks `35640386188` and its single unchanged retry also failed at
local startup (SSR, then the full graph), despite the earlier 219-test pass and
successful release-artifact CI. Investigation is separate from the cloud failures.
Ticket #14 and release acceptance were still open at that point, with a publication
warning in place. The completed acceptance above supersedes that status. No registry
publication has occurred.

### Repeated large-checkpoint regression

An isolated state-only reproducer consistently stalled after five successful
20 MiB encrypted write/read cycles. Node transport, buffered request forwarding,
explicit storage synchronization and smaller SQLite transaction batches did not
resolve it. The 10 MiB case passed twenty cycles; plaintext and same-request crypto
controls also passed. No CPU/memory exception was reported, so the precise provider
admission mechanism remains unproven.

Native Base64 conversion reduced measured temporary host allocations and passed
twenty full 20 MiB encrypted write/read cycles against an isolated real backend.
It preserves the version-one envelope, authenticated stack/environment context
and atomic SQLite checkpoint/receipt transaction. All diagnostic backends, tails
and namespaces were removed. The production change retains a bounded standard
Base64 fallback for host engines without the native methods. Wire-format and
legacy-envelope tests run on both Node and Bun; the opt-in maintained provider
regression is documented in `packages/cloudflare/README.md`. This source change
requires fresh release-artifact validation; it does not alter the provenance or
previous results of archive `ad218c4191b3f24e6f1c0ef9e1572f07cdcc7662ba5beedbd0c5843aec5d54fb`.

The maintained test then passed against the uninstrumented production coordinator:
twenty 20 MiB checkpoints, lease inspection, empty-state removal and exact temporary
Worker/namespace cleanup, in 53.58 seconds. Focused validation also passed 14 unit
tests on Node, the same 14 on Bun, 34 state integration tests, TypeScript, Biome and
Knip. No diagnostic batching, request-forwarding or phase logging entered production.
