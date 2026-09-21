# Issue 7 validation

Implemented against ticket #7 and parent #3 on 2026-09-21. No Alchemy dependency
or copied source was introduced. Reference revisions and endpoint boundaries are
recorded in [R2 and preview usage](../r2-and-previews.md).

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Local/cloud R2, native handles, persistence, isolation, metadata and CORS | Public local tests restart native storage and isolate two named previews with the same logical bucket IDs. Actual Cloudflare native PUT / S3 GET, application-signed PUT / native GET, HTTP/custom metadata and configured CORS passed. |
| Opt-in S3 configuration; application signs | Independent `aws4fetch` development dependency signs requests in a real Worker. Production Renkin exposes configuration and verification only. Disabled S3 leaves application routing intact. Token-only requirements expose only their declared buckets. |
| PUT/GET/HEAD/OPTIONS, encoded keys, metadata, ETags, overrides and ranges | Actual Miniflare bucket tests cover spaces, Unicode and literal percent sequences, native interoperability, restart, single/suffix/open ranges, multiple-range fallback, invalid ranges, HEAD and local preflight. Cloud checks cover encoded keys, ETags, metadata, HEAD and ranges. |
| SigV4 bounds and errors | Independent signer plus deterministic verifier time checks cover 1 and 604800 seconds, invalid expiries, exact expiry boundary, expired requests, exact 15-minute skew boundary, future skew, malformed dates, duplicate fields, session tokens and invalid signatures. Unsupported upload semantics return 501 without writing. |
| Named preview buckets and scoped account tokens | Two actual Cloudflare environments received different physical buckets and account-owned tokens. Cross-bucket access and read-only PUT were denied. Application credentials were delivered through a secret binding; inspection redacted outputs. |
| Exact cleanup and protection | Full cloud lifecycle blocked protected removal and nonempty removal without `forceDestroy`, recovered after explicit identity-preserving permission correction, revoked exact tokens and deleted exact buckets/Workers. The other preview survived. A separate maintained connected-Worker cloud regression verified that a permanent cross-stack Worker remains callable after preview cleanup. Removed environments disappeared from read/list. Tests reject token ownership mismatch and REST dot-segment deletion before dispatch. |
| State and one-time-secret safety | Real SQLite Durable Object tests preserve encrypted receipts across lease loss, reject another resource kind/request, and acknowledge only matching saved secrets. Empty-state removal rejects resources, outputs, pending work and receipts; stale leases cannot resurrect removed records. File-state tests serialize writes/removal before lock release. Shared backend upgrade checks separately verified encryption-key/namespace preservation and a 10.54 MB encrypted snapshot roundtrip. |

## Executed checks

Using Bun 1.4.2 and the locked dependencies:

- TypeScript project build, Biome and Knip passed.
- Core: 18 unit tests and 5 integration tests passed.
- Cloudflare SDK: 32 integration tests passed.
- Cloudflare resources/state: 57 integration tests passed, including same-name bucket reincarnation and pinned-jurisdiction ownership guards.
- Runtime: 13 integration tests passed.
- Public API/CLI: 17 integration tests passed.
- Total credential-free behavioral checks: 142 passed; no zero-test project was counted.
- Maintained R2 cloud suite passed in 189.56 seconds. This includes the complete
  two-preview lifecycle and successful cleanup. Cloud credentials were provided
  through the ignored root `.env`; no secret values were recorded here.
- Maintained connected-Worker cloud regression passed in 142.59 seconds, proving
  external cross-stack Worker survival and exact owned fixture cleanup.

The cloud suite has per-request timeouts, bounded read propagation checks, a
scenario deadline and a separate cleanup allowance. It uses the explicit test
prefix, product authorization, token-management authorization and expiry checks.
No broad name-pattern deletion or shared-backend deletion occurs.

## Investigation outcomes

The first cloud assertion failure came from the test application concatenating
an extra slash onto a normalized endpoint. Independent signatures and credentials
matched; the doubled path did not. Using `new URL(relativeBucketKey, endpoint)`
fixed the application fixture. Token policy was not broadened. A later revoked
credential returned HTTP 401 rather than the test's expected 403; the assertion
now accepts both authentication and authorization denial. Initial workers.dev
404s are handled with bounded read-only propagation polling.

Failed exploratory runs `renkin-test-r2-0c78082b`, `renkin-test-r2-8d7a2f4d` and
`renkin-test-r2-7b1bcc31`, plus the focused probe `renkin-test-r2-62989ead`, completed
cleanup of their exact owned environments. The successful maintained suite also
asserted an empty environment index and completed its cleanup scope.

## Explicit limits

The local endpoint is intentionally not a full S3 implementation and its CORS is
permissive. Local development keys do not simulate cloud per-token read-only or
expiry policy. Vite forwarding belongs to the application-graph slice. Cloud REST
cleanup refuses dot-segment object keys rather than normalizing to a different
object; use exact native/S3 cleanup then retry. Retained objects are intentionally
left unmanaged, and unbound local emulator files may remain. See the usage guide
for the public configuration and recovery procedure.
