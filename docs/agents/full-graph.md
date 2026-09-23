# Representative application graph

The fixture at `packages/renkin/tests/fixtures/full-graph` uses public `@carere/renkin`
entrypoints to connect five services and three independent Solid frontend roots.
It is an executable application example, not a production authentication system.
Review and Companion are separate applications and are not declared, started or
owned by this stack.

After the repository's normal dependency installation, run from the repository root:

```sh
bun --no-env-file packages/renkin/tests/fixtures/full-graph/dev.ts
```

The command prints eight local URLs. Open Console, choose **Sign in locally**, then
**Create order**. The same order appears in Customer Hub and Storefront after signing
in there. **Upload attachment** signs PUT and GET requests in the API and sends them
from the browser to the frontend's reserved local S3 endpoint. Renkin supplies native
bindings and local credentials; the application uses `aws4fetch` to sign requests.
The three Vite servers support frontend reload; the five service Workers use the
native local graph. Stop with Ctrl-C. Native data persists under `.renkin` between runs.
Use a new order ID for another order; the D1 primary key deliberately rejects duplicates.

| Application | Connected behavior |
| --- | --- |
| Auth | Local demonstration login stored in native KV; API validates its bearer token |
| API | Applies D1 migrations on startup; inserts orders, publishes queue messages, signs R2 requests |
| Jobs | Native queue consumer starts an actual Workflow; failed poison messages retry then enter the DLQ |
| Notifications | Sends locally captured email and records delivery in KV; consumes the DLQ |
| Tracking | Named SQLite Durable Object records orders and executes its alarm; scheduled event writes an audit record |
| Console | Solid SPA, Effect service adapter, TanStack Query, native service binding, browser S3 upload |
| Customer Hub | Separate Solid SPA reading the same authenticated API |
| Storefront | Solid SSR with a server-side native API read, then browser hydration and queries |

`graph.ts` owns infrastructure such as the cron declaration. Vite imports only
`frontends/config.ts` and the pure resource descriptors, so infrastructure-only edits
are not hidden frontend build inputs. The three roots share `frontends/shared` UI and
Effect adapter code. Production reuse must declare those shared inputs and the resource
descriptors explicitly; see [build reuse](build-reuse.md) for the combined build workflow.

The local defaults intentionally use a fixed demonstration bearer token, local S3
credentials, and example email addresses. No provider token is created and no real
email is sent by `development`. `graph({ notification: { from, to } })` lets an authorized
cloud validation supply its sender and recipient without editing source. The local R2
token descriptor's distant expiry is not an approved cloud lifetime: cloud callers must
supply a short authorized lifetime and explicit disposable-resource deletion settings.
Do not deploy this local fixture unchanged as a production application.

## Maintained acceptance

Install Chromium once (`bun x playwright install chromium`), then run:

```sh
bun --no-env-file packages/renkin/tests/support/root/full-graph/run.ts --network-denied
```

The same scenario is included in Renkin's integration project:

```sh
cd packages/renkin
bun vitest run --project integration tests/integration/root/full-graph.test.ts
```

The harness copies the consumer fixture to a fresh temporary directory, links only
installed package dependencies, and creates fresh Vite caches and persistence. It
starts Bun with `--no-env-file` and an allowlisted environment: no provider credentials,
proxy settings, or unrelated service secrets. `HOME` is preserved. A fresh
`XDG_CONFIG_HOME` and disabled Cloudflare keyring prevent saved-login discovery.
This validates the source-workspace public package; release tarball validation is a
separate acceptance boundary.

On macOS, `sandbox-exec` denies all outbound networking except loopback and denies
reads under the legacy `~/.wrangler` path (which may already be absent). On Linux,
the harness requires a fresh user with no legacy profile and passwordless
`sudo unshare --net`; it enables only the namespace's loopback interface, then uses `setpriv` to drop
back to the invoking user and group before starting Bun. This keeps generated state
and cleanup under the consumer's ownership. Unsupported
platforms or unavailable isolation fail explicitly. Neither mechanism is a runtime
dependency of Renkin. Run outside another sandbox if it prevents Chromium or creating
the narrower network sandbox. The test first confirms an external TCP connection to
`1.1.1.1:443` works outside isolation and then fails inside it; this is a credential-free
TCP control, not a provider API operation. All application and browser requests then
run under the network restriction.

Assertions cover authentication rejection, native migration execution, successful
queue/Workflow/email/DO flow, retry count and DLQ delivery, scheduled dispatch, SQLite
alarm execution, three hydrated frontend roots, SSR native access, browser-origin
signed PUT/GET, signature tamper rejection, and reserved-path precedence. Editing the
copied frontend updates the open browser; editing the API and calling its public
`reload()` preserves data. The public `applicationFixture` restarts all eight apps,
preserves native state and DO identity, applies one added migration, and confirms the
completed Workflow does not send another message. Captured mail is session-scoped,
so the new session starts with no captured messages. A second stack name using the same
state directory has independent D1, R2 and DO data. Scoped runtimes, browser processes,
and the temporary consumer/state are closed and removed after success or assertion failure.


The separate cloud scenario is `tests/cloud/root/full-graph.test.ts` in the Renkin
package. It requires current explicit resource, token-management and email scope,
replaces local resource lifetimes and deletion settings, and uses one temporary
stack. Its intended checks are the connected native flow, signed R2 access, one
email send with Workflow task retries disabled, and a provider-observed cron change
without recompiling the three frontends. A local owner-only JSONL ledger records
allocated scopes, provider IDs after deployment and completed environment cleanup.
It is not part of the normal integration command.
