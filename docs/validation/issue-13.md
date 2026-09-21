# Build reuse and representative graph — 2026-09-21

Ticket #13 adds local raw-artifact reuse and the representative eight-application
graph. No remote artifact cache or Alchemy dependency/source was added. Installed
release-artifact verification remains the separate #14 boundary.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Five services and three frontends | Public `full-graph` fixture starts Auth, API, Jobs, Notifications, Tracking, Console SPA, Customer Hub SPA and Storefront SSR. Review and Companion are absent. |
| Clean provider-free startup | Fresh copied consumer, stripped credentials/proxies, fresh XDG configuration, disabled keyring, legacy-profile denial and OS loopback-only enforcement. Both macOS sandbox and Linux network-namespace runs passed. |
| Native behavior and restart | Real D1 migrations, KV authentication, queue→Workflow→captured email→SQLite DO/alarm, retry/DLQ and scheduled dispatch; frontend HMR, Worker reload, persisted data/stable DO identity and a separate isolated stack. |
| Trusted browser R2 forwarding | Real Chromium signed PUT/GET reaches native R2 through the frontend origin; tampered signatures fail, the reserved endpoint precedes SPA fallback and normal routes remain available. |
| Four framework modes | Actual TanStack Solid SPA/SSR and Astro static/SSR compile tests invalidate on shared source, lock/config/public inputs and stage values. Two differently bound declarations share one raw compile and retain separate binding wrappers. |
| External and standalone builds | Public Moon→Bun→`buildAstro` nesting, direct argv command and ordinary public framework helpers; deleted manifest restored, no private builder import or recursive output-lock conflict. |
| Missing output and immutable capture | Real filesystem tests delete/corrupt entries, chunks, maps, assets and routing controls; failed/input-changing builds publish no successful receipt. Concurrent stages retain separate captured bytes and competing processes cannot take over a live output lock. |
| Infrastructure reconciliation on reuse | Maintained real-cloud graph test passed: provider-observed cron changed, Tracking identity stayed stable, and all three frontend artifacts were reused without another compiler invocation. |

## Completed checks

- Before graph integration: runtime integration 21 tests, websites integration six,
  and public Renkin integration 38 tests passed.
- After graph merge at `57b842e`: runtime 21, websites six and Renkin 39 tests
  passed (66 combined), including the provider-network-denied eight-app scenario.
- Focused full-graph regression passed again after adding email-attempt observation,
  disabling retries for the email-containing Workflow task and preserving the
  invoking Linux user's ownership after network namespace setup.
- The provider-free prepared-cloud-graph regression passed: all 17 resources remain
  explicitly deletable and unretained after actual compilation/dependency expansion,
  the durable definition is structured-cloneable, the real planner produces 17
  creates, and frontend Worker references resolve by identity without reintroducing
  original protected resource definitions.
- Final public Renkin integration passed 41 tests in 20 suites. The already-passing
  prepared-cloud-graph test was excluded from that run to avoid sharing output
  ownership with the active cloud test; together these cover all 42 public
  integration tests. The two new HTTP-boundary regressions passed separately too.
- Strict TypeScript project build, Biome and Knip passed at the final
  checkpoint. After merge `06e117a`, all 210 tests across 13 populated suites and
  required static checks passed locally and in [Linux CI](https://github.com/carere/renkin/actions/runs/35621947210),
  including the network-denied graph with the original user identity restored.

The source-workspace API and actual compilers/native runtimes were exercised.
Framework source maps remain adjacent to captured entries as auxiliary output;
those maps are not uploaded as Worker JavaScript modules. Cache receipts validate
both producer outputs and the immutable capture. Hash-specific per-resource
wrappers are written atomically after raw capture and excluded from raw inventory.

## State capacity and cloud status

The built graph measured 5,203,102 bytes of definitions, a 15,608,643-byte deferred
create checkpoint and a 20,810,556-byte deferred refresh/update checkpoint, before
small provider outputs. The existing canonical coordinator successfully round-tripped
17,250,144 and then 24,000,144 plaintext bytes through its encrypted storage. Each
synthetic environment was cleared, removed and verified absent; the backend was
not upgraded. These probes establish state capacity, not application deployment.

The user explicitly authorized the eight-app, 17-resource test and one email
within the existing account, deadline and total spend limit. The first command
wrapper did not propagate its explicit environment file and stopped before scope
allocation; direct Bun execution of Vitest loads that scope correctly.

Two failed application attempts were recovered and fully removed before another
scope was created:

- `renkin-test-graph-5a40924a/full-graph`: deferred Worker binding exposed a missing
  `backgroundClient` option in public cloud composition. Queue and Workflow adapters
  received the client, but Workers did not. The one-line fix is covered by a real
  constructed-adapter/SDK wire regression: it fails with the exact missing-client
  error before the fix and observes the fenced cron PUT afterward. Recovery completed
  pending bindings, removed owned resources and verified an empty environment list.
- `renkin-test-graph-eb281a0f/full-graph`: the test-only request timeout wrapper spread
  a `Request` passed as fetch's second argument, dropping its non-enumerable auth
  headers during queue pagination. A real loopback HTTP regression reproduced the
  missing header; normalizing `new Request(input, init)` before adding the timeout
  preserves it. Same-scope recovery/removal succeeded and the environment list was
  empty. Neither failed attempt reached its email action.

The maintained scenario has a 20-minute total bound and 60-second individual request
bounds, preserving existing cancellation. Endpoint assertions use shorter bounds.
No provider mutation is blindly retried.

The complete maintained cloud test passed (one test, 711.21 seconds) in
`renkin-test-graph-60c60f6d/full-graph`:

- All three frontend roots returned successful pages. KV authentication, D1 order
  migration/write, queue delivery, native Workflow completion, one accepted email,
  SQLite DO record and alarm all passed their assertions.
- Signed R2 PUT/GET and the API's native bucket read returned the expected bytes;
  changing the signed object's path was rejected.
- The provider initially reported `0 0 1 1 *`, then `0 1 1 1 *` after the second
  deployment. Tracking's physical identity remained unchanged. The three frontend
  compilations were reused: the counter stayed at three after the cron-only change.
- Initial deployment returned at 15:39:30 UTC; the updated deployment returned at
  15:44:30 UTC. Exact cleanup completed at 15:46:39 UTC, with all 17 owned resource
  records removed and the environment list verified empty. The ledger recorded
  both deployments' physical IDs and successful cleanup; no custom domain or
  certificate was created.

Both earlier scopes were also fully removed. They sent no email; the successful
scope observed exactly one attempt and one acceptance. Including the earlier #8
validation, the coordinated test email count is two of the authorized maximum 20.
Temporary diagnostics were removed. No application resource or state environment
from #13 remains intentionally allocated.
