# Worker slice validation — 2026-09-21

Executed on macOS with Bun 1.4.2, Node 24.21.0, Effect 4.0.0-rc.115 and the
versions in `bun.lock`. These results concern ticket #4, not the complete release.

## Local checks

- TypeScript project build, Biome, Knip and package-manifest sorting passed.
- Moon workspace synchronization passed.
- Core: 11 tests passed, including protected-plan rejection, changed protection
  during recovery, create/update/replacement/binding/removal checkpoints,
  corrupted records, owner-only JSON files, independent environment locks and
  killed-process recovery. The three core integration tests also passed with
  the Vitest runner executing under Bun itself.
- SDK: 22 tests passed, covering released Distilled HTTP behavior, authentication,
  bounded throttling retry, multipart uploads and the protected-preview protocol.
- Cloudflare: 16 tests passed through the actual SDK HTTP boundary and Miniflare
  Durable Objects, including expired crashed-client leases, stale requests,
  encryption and state-authentication rejection. The real lease-expiry test takes
  approximately 60 seconds.
- Runtime: one real workerd HTTP/source-watch test passed.
- Public package: five tests passed, covering ordinary and Effect Workers through
  public entrypoints, typed Effect requirements, separate-process JSON reads,
  and one-command dev startup/reload with provider credentials absent.
- The populated Moon tasks were executed. Untouched workspace projects still
  contain empty suites; they are not included in this behavioral claim.
- [Linux CI](https://github.com/carere/renkin/actions/runs/35556343974) passed all
  55 behavioral tests and static checks on checkpoint `d6a0819` (Ubuntu 24.04).

## Authorized Cloudflare checks

The user-provided temporary test account, `renkin-test` prefix, product/budget
permissions and authorization expiry were checked before invocation. Credentials
were loaded from the ignored root environment file and were not logged.

Two initial lifecycle runs against the v1 backend passed (38.24s and 36.87s).
Review then found that accepting account-read credentials at the state endpoint
was insufficient authorization. Those passes do not validate the final security
boundary. The backend protocol was replaced by v2 with a dedicated state secret
retrieved through a Workers Edit authorized ephemeral preview.

The first v2 check failed during authentication setup. A minimal, sanitized
request trace isolated HTTP 400 at the optional preview-token exchange. The
upstream Workers SDK falls back to the original session token in this case.
A differential live probe proved that token succeeded, and the SDK now follows
that behavior with local regression coverage. The failed bootstrap did not reach
application-resource creation.

The final v2 lifecycle run passed in **56.85s**. It created a prefixed temporary
Worker, observed HTTP `one`, updated it in place, observed HTTP `two`, listed its
environment, read redacted shared outputs, read outputs from an independent Bun
CLI process while its infrastructure file deliberately threw if evaluated, and
removed the exact owned application Worker. The final output record was empty.

No application Worker cleanup failure remains from the successful runs. The
prefixed v2 account state service and empty environment records are intentionally
retained for subsequent ticket tests. The parent task also ran the separate restricted-token test in **13.37s**:
active Account Settings Read and Worker Scripts Read tokens could perform their
expected provider reads but could neither use the state endpoint nor recover
its dedicated secret through preview. Both temporary tokens were revoked.
The parent verified that only the two task-created backends remained, then
retired the exact v1 backend after checking its ownership tag, account binding
and Durable Object class. Only the secured v2 state service remains.

## Limits still tracked by the parent specification

The rare failure window where the coordinator loses its process after journaling
but before a provider dispatch can be proved complete remains quarantined. It
is never interpreted as permission for an overlapping or stale mutation.
The parent task is resolving the required operator workflow for this ambiguous
provider outcome; the current state is not a claim of unlimited automatic crash
recovery. Ordinary deployment-client crashes are covered independently.

This slice does not validate a packed package, additional resource adapters,
framework integrations or the complete application graph.
