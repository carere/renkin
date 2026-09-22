# Workers, state and recovery

Renkin supports ordinary and Effect-based HTTP Workers, credential-free local
execution, encrypted shared state, and recoverable deployment checkpoints.

## Authoring

Define implementation separately from deployment settings. An ordinary Worker
can default-export its standard `fetch` handler. For Effect code:

```ts
// worker.ts
import { Effect } from "effect";
import { defineWorker } from "renkin/worker";

export default defineWorker({
  fetch: (request) => Effect.succeed(new Response(new URL(request.url).pathname)),
});
```

`defineWorker` also accepts one application layer as its second argument when
handlers require services. Missing Effect requirements are a type error. The
layer is scoped to each request; pass application dependencies here once rather
than passing Renkin runtime objects through adapters. Ordinary Workers need no
Renkin runtime wrapper.

```ts
// renkin.ts
import { defineStack, output } from "renkin";
import { worker } from "renkin/cloudflare";

export default defineStack({
  name: "hello",
  resources: [worker("api", {
    entry: new URL("./worker.ts", import.meta.url).pathname,
    compatibilityDate: "2026-07-30",
    port: 8787,
  })],
  outputs: { message: output("hello"), password: output("example", { secret: true }) },
});
```

Use Bun on macOS or Linux. From this checkout:

```sh
bun packages/renkin/src/contexts/root/cli/main.ts dev --file ./renkin.ts
bun packages/renkin/src/contexts/root/cli/main.ts plan --file ./renkin.ts --env dev
bun packages/renkin/src/contexts/root/cli/main.ts deploy --file ./renkin.ts --env dev --yes
bun packages/renkin/src/contexts/root/cli/main.ts list --stack hello
bun packages/renkin/src/contexts/root/cli/main.ts outputs --stack hello --env dev
bun packages/renkin/src/contexts/root/cli/main.ts remove --stack hello --env dev --yes
```

`dev` runs esbuild and workerd via Miniflare, watches source imports, retains the
last working build on compilation failure, and releases its resources on SIGINT
or SIGTERM. It does not read Cloudflare credentials or invoke the provider.
`list` and `outputs` accept `--local --state-dir .renkin` for local records. These
commands never import the infrastructure file. JSON goes to stdout; plans,
confirmation, development URLs and progress go to stderr. Resource outputs appear
under their logical IDs (for example `api.url`); declared outputs can add names. `--reveal-secrets`
explicitly includes secret output values; ordinary output reads redact them.

The TypeScript API exports `development`, `planDeployment`, `deploy`,
`removeEnvironment`, `listEnvironments` and `readOutputs` as Effect operations.
Use `Effect.scoped(development(stack))` when controlling local session lifetime.
`workerFixture` from `renkin/testing` is an Effect-scoped real workerd fixture.
See `packages/renkin/tests/fixtures/worker` for checked consumer examples.

## State, authentication and recovery

Cloud operations accept an API token and account ID through
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, or explicit `cloudflare` options.
No browser login, saved account profile or global account-key flow is used.
The account must have a workers.dev subdomain. Initial deployment provisions an
account state Worker and SQLite Durable Object namespace automatically. Its
name defaults to `renkin-state-v2`; `cloudflare.stateScriptName` or
`--state-worker` selects a separate permanent backend. It must survive ordinary
environment cleanup. Inspection commands do not provision a missing backend.
A pre-existing backend is accepted only with the expected ownership tag and
account/namespace bindings, and is not silently overwritten. Its dedicated random
state-authentication secret is recovered through an authenticated ephemeral
Cloudflare preview by callers with Workers Edit permission. An account-read-only
token cannot retrieve state secrets. The Cloudflare API token is used separately
for provider mutations and is never accepted as the state bearer token.

Cloud state uses AES-256-GCM with random nonces, a versioned envelope and
stack/environment authenticated associated data. The server creates its key
once using an atomic insert. Key material remains in Durable Object storage,
is never sent to clients, and is not derived from the caller's API token. This
protects ciphertext outside the service; it does **not** protect against an
attacker who obtains both the coordinator's raw storage and its encryption key.
Cloudflare's storage encryption additionally applies. Missing records are
separate from authentication, decoding and decryption errors; errors never
become empty state.

Local records are ordinary JSON files under ignored `.renkin/`, with 0600 files
and 0700 created directories. They may contain secrets. Do not commit or share
them. A SQLite sidecar supplies an OS-managed exclusive environment lock; a
killed process releases the lock automatically. Different environments have
independent locks.

Cloud changes use renewable environment leases. Every provider mutation crosses
the authoritative coordinator, which validates ownership and the current lease
at dispatch and journals in-flight requests. A stale client cannot mutate via a
lease it no longer owns. An expired idle lease is reclaimable immediately; a
busy lease fails instead of waiting. The coordinator records exact operation
tags for Worker uploads and observes explicit outcomes when recovering.
Unresolved provider dispatch is quarantined rather than replayed blindly; the
exceptional coordinator-loss ambiguity and its operator workflow remain under
review against the parent specification. Ordinary client-process loss does not
lose a provider request that is still executing at the coordinator.

The engine records a physical identity before creation, persists apply/binding/
old-resource-removal checkpoints, and retries idempotent operations after an
interruption. Updates keep identity; changing `identity` explicitly replaces a
stateless Worker. `--yes` skips confirmation and `--force` reruns an unchanged
resource. They do not override deletion protection. The entire requested plan
is checked before provider changes, including projected interrupted resources.
Provider actions verify exact ownership tags before updating or deleting.
Retention keeps the physical Worker and explicitly gives up ownership.

`remove` removes owned application resources and clears outputs. It currently
retains the empty environment record as an audit record. Use `removeEnvironment` to delete an empty named environment; see
[R2 and previews](r2-and-previews.md#explicit-cleanup).
The permanent state Worker is never part of the application resource plan.
Deploy effects hold their lease to completion even if the calling fiber is
interrupted. Failed deployments preserve pending operations; rerun to recover.
This is resource recovery, not SQL rollback.

## Validation

Local suites use no Cloudflare credentials:

```sh
moon run core:test-unit core:test-integration
moon run cloudflare-sdk:test-integration cloudflare:test-integration
moon run runtime:test-integration renkin:test-unit renkin:test-integration
```

The separate `renkin:test-cloud` suite creates only resources under the explicit
`RENKIN_CLOUDFLARE_TEST_PREFIX`, requires a future
`RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL` plus
`RENKIN_CLOUDFLARE_TESTS_AUTHORIZED=true` and
`RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED=true`. It deploys and updates a temporary
Worker, verifies HTTP and shared output reads, then removes that Worker. Cleanup
failures report its exact stack/environment. The reusable prefixed account state
service and empty environment record remain intentionally. The separate optional
`cloudflare:test-cloud-authorization` suite additionally requires explicit
token-management authorization and `RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN`.
It creates narrowly scoped read-only tokens, proves they cannot access shared
state, then revokes both. The ordinary Worker cloud suite does not require token
management credentials.

The released Distilled dependency is `@distilled.cloud/cloudflare@1.0.0-rc.12`,
compatible with the workspace's Effect `4.0.0-rc.115`. Its HTTP boundary tests
cover bearer authentication, bounded throttling retry, exact missing-Worker
versus invalid-route errors, authentication failures, upload multipart encoding
and fenced mutation transport. See the SDK README for details. No Alchemy or
Distilled implementation source was copied into this slice.

## Reconcile an ambiguous provider operation

A deployment client can crash and recover through its lease and checkpoint.
A coordinator crash during a Cloudflare request is different: the provider may
have accepted a request whose outcome Renkin cannot establish. The environment
stays quarantined. The accepted recovery exception is recorded in
[ADR 0007](../adr/0007-reconcile-ambiguous-provider-operations-explicitly.md).

Inspect without evaluating an infrastructure file:

```sh
renkin inspect --stack app --env production
```

The JSON reports the exact operation ID, HTTP method, target path, operation tag
when available, lease expiry, whether a dispatch remains active in this
coordinator, and past reconciliation receipts. It excludes request bodies,
authorization tokens, query strings and stored application outputs. Audit
receipts are encrypted in durable storage. Operator labels and evidence
references are included in the authorized inspection response; never put
credentials or secret payloads in these fields.

Stop deployment clients and investigate that exact request with Cloudflare.
Establish whether it completed or was not applied, and whether it can still
complete later. A missing resource, an expired lease, or elapsed time alone
cannot establish settlement. If settlement cannot be established, leave the
environment blocked. Record a support case or audit reference, then explicitly
accept responsibility for the settlement assertion:

```sh
renkin reconcile --stack app --env production \
  --operation 00000000-0000-4000-8000-000000000000 \
  --outcome completed --operator operator@example.com \
  --evidence support-case-123 --provider-settled
```

Use `--outcome not-applied` only when that is the established outcome.
`--yes` skips the confirmation prompt; neither it nor `--force` replaces
`--provider-settled`. A live lease, active coordinator dispatch, changed
operation ID, or repeated receipt is rejected. Successful reconciliation records
an encrypted receipt, advances the fencing epoch and clears only that gateway
quarantine. Ownership, outputs and deployment checkpoints remain intact.
Rerun the normal plan/deploy/remove workflow to resume from the checkpoint.

The public Effect APIs are `inspectRecovery(stack, environment, cloudflare?)`
and `reconcileOperation(stack, environment, decision, cloudflare?)`, with decision
fields `operationId`, `outcome`, `operator`, `evidence` and `providerSettled: true`.
They only discover an existing state service. Existing deployed state services
need this coordinator revision before they can serve these routes; preserve the
same Durable Object namespace and shared secret when upgrading the service.

The operator assertion is not a Cloudflare guarantee. Renkin fences subsequent
requests from stale clients, but cannot cancel a request Cloudflare already
accepted or prove it will never complete late. The current Worker adapter uses
idempotent apply/bind/remove operations. Reconciliation does not invent a provider
response or mark a core checkpoint complete. Future non-idempotent resource
adapters must consume the recorded outcome and recover the final resource identity
or observed state before resuming; blindly replaying such a POST is not supported.
