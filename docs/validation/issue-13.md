# Build reuse and representative graph — 2026-09-21

Ticket #13 adds local raw-artifact reuse and the representative eight-application
graph. No remote artifact cache or Alchemy dependency/source was added. Installed
release-artifact verification remains the separate #14 boundary.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Five services and three frontends | Public `full-graph` fixture starts Auth, API, Jobs, Notifications, Tracking, Console SPA, Customer Hub SPA and Storefront SSR. Review and Companion are absent. |
| Clean provider-free startup | Fresh copied consumer, stripped credentials/proxies, fresh XDG configuration, disabled keyring, legacy-profile denial and OS loopback-only enforcement. The macOS run passed; Linux namespace validation awaits CI. |
| Native behavior and restart | Real D1 migrations, KV authentication, queue→Workflow→captured email→SQLite DO/alarm, retry/DLQ and scheduled dispatch; frontend HMR, Worker reload, persisted data/stable DO identity and a separate isolated stack. |
| Trusted browser R2 forwarding | Real Chromium signed PUT/GET reaches native R2 through the frontend origin; tampered signatures fail, the reserved endpoint precedes SPA fallback and normal routes remain available. |
| Four framework modes | Actual TanStack Solid SPA/SSR and Astro static/SSR compile tests invalidate on shared source, lock/config/public inputs and stage values. Two differently bound declarations share one raw compile and retain separate binding wrappers. |
| External and standalone builds | Public Moon→Bun→`buildAstro` nesting, direct argv command and ordinary public framework helpers; deleted manifest restored, no private builder import or recursive output-lock conflict. |
| Missing output and immutable capture | Real filesystem tests delete/corrupt entries, chunks, maps, assets and routing controls; failed/input-changing builds publish no successful receipt. Concurrent stages retain separate captured bytes and competing processes cannot take over a live output lock. |
| Infrastructure reconciliation on reuse | Maintained cloud cron-change test is implemented but has not run. No claim of live graph deployment or cron reconciliation yet. |

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
- Strict TypeScript project build, Biome and Knip passed at the cloud-test preparation
  checkpoint. The Linux branch requires CI; a macOS pass does not validate it.

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

The separate full-graph cloud command was rejected by automatic approval review
before process creation because the review considered the eight-app artifact set
and email outside the earlier approval. No #13 application resources or email were
created. Explicit scope clarification is pending; cloud deployment, native graph
behavior, provider-observed cron-only update and application cleanup remain unrun.
