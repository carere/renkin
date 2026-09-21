# Ticket #5 validation

Validated on macOS with Bun 1.4.2, Effect 4.0.0-rc.115, Distilled Cloudflare
1.0.0-rc.12 and the locked Miniflare/workerd release on 2026-09-21.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| Typed and native KV without repeated runtime setup | `renkin` connected Worker integration exercises `defineWorker` requirement resolution, native and Effect read/write, JSON/list/delete, restart and hot reload. Runtime native KV integration accepts official `KVNamespace`, checks identity, metadata/options and bulk reads. |
| Local and cloud mutual calls, including named entrypoints | Connected Worker integration and separately invoked real-cloud suite both execute A → B named RPC → A fetch. Type tests preserve service method inference and unrelated Effect requirements. |
| Permanent/external Worker ownership | Local external Worker fixture and cloud consumer bind a separate service. Cloud suite removes the consumer, verifies permanent service HTTP and its owning outputs, then removes the permanent service through its own owner. |
| Entire-plan protection, explicit disposal and retention | Core mixed-plan tests assert zero mutations with protected removal even with force/yes. Actual SDK KV replacement gets a different provider ID and deletes only the old namespace. Core retention test keeps the object while dropping its owned record. Cloud mixed-plan test preserves outputs and data. |
| Explicit rename preserving data and identity | FileState integration tests committed-write interruption/retry, collision/type rejection and dependency rewrite; local restart/rename preserves KV value. Cloud rename preserves the namespace provider ID and value. |
| Recovery and binding order | Core tests checkpoint returned provider IDs before bindings, recover interrupted graphs, persist force, finish binding graphs before removal, and redirect callers before replacement cleanup. Actual SDK loopback tests recover after detach, reject changed ownership/configuration, and never pass provider force. |
| Metadata and ownership boundaries | Actual workerd inspection tests deny outbound calls and avoid handler-factory execution. Undeclared/wrong-type managed references fail before provisioning. External references are excluded from owned state. |

## Real Cloudflare run

The maintained `packages/renkin/tests/cloud/root/connected-worker.test.ts` passed
on 2026-09-21: one test, 127.83 seconds. Exact owned scopes were
`renkin-test-4affa8c6/graph` and `renkin-test-4affa8c6-permanent/graph`.
It verified actual Worker HTTP, native/Effect KV data, mutual named RPC,
external service calls, mixed-plan protection, namespace rename and final cleanup.
All application Workers and KV namespaces from that run were removed through
normal public lifecycle APIs. The secured shared `renkin-test-state-v2` backend
and empty encrypted environment audit records remain intentionally.

Earlier diagnostic runs exposed emulator compatibility-date mismatch, oversized
encrypted state rows and Cloudflare's refusal to delete a bound Worker. Those
failures were fixed before this passing run. Exact prior scopes
`renkin-test-ddf30b20`, `renkin-test-ff2eca30` and `renkin-test-42085ed3`, plus
their permanent owners, have no remaining application resources. The initial
date failure did not provision application resources. Cleanup used owned records
and normal deletion; no force deletion, wildcard cleanup or foreign mutation.

Cloud tests are separate from normal suites and require a current, explicitly
authorized prefixed scope. They do not run in credential-free CI. Root coordination
upgraded shared encrypted state chunking and subsequently bounded base64 decoding
while preserving backend identity and secrets; ticket #4/#10 records describe those
independently verified state changes.

## Local checks

Strict `bun tsc --build`, full `bun biome check .`, `bun knip`, and sorting checks
for all 12 manifests passed. Biome reports one informational template-literal
suggestion in the existing chunked-state test, with no errors.

Package suites and the focused post-fix reruns established:

| Package | Passing tests |
| --- | ---: |
| core | 21 |
| cloudflare-sdk | 25 |
| runtime | 9 |
| renkin | 9 |
| cloudflare | 32 |

The first full Cloudflare package run found a receipt compatibility regression:
an opaque non-JSON state fixture could no longer be written. The shared receipt
fix preserves opaque snapshots without treating them as acknowledgement evidence;
the affected actual-Durable-Object coordinator suite then passed all eight tests.
The other 23 tests had passed in the full run, and the additional requirement
membership test passed separately. This record does not claim a second full suite
run after that focused correction; combined-branch CI is handled by the parent task.

## Provenance and limits

The implementation was written independently against the public resource and
runtime contracts. It uses installed Distilled operations and type-only official
Cloudflare KV types; no Alchemy or Distilled implementation source was copied.
`@cloudflare/workers-types` is a declared dependency because consumers of emitted
declarations need the native KV surface. Release packaging must preserve it.

The provider's no-force cleanup choice follows the documented
[Workers delete contract](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/).
Unknown coordinator-loss outcomes remain subject to the accepted explicit
reconciliation exception in ADR 0007. Local emulation is not proof of every
Cloudflare feature; the selected flows above were checked on both.

Only populated package suites count as behavioral coverage. Unimplemented app,
framework and release workspaces remain outside ticket #5; empty projects and
typechecking alone are not counted as tests.
