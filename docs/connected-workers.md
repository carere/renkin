# Connected Workers and protected KV

Declare a resource once in a lightweight module shared by infrastructure and
implementation. Deployment options stay with the stack; the implementation declares
its resource requirements once. Renkin derives bindings and provisions their targets.

```ts
// resources.ts
import { kv } from "renkin/cloudflare";
export const Cache = kv("Cache");

// worker.ts
import { Effect } from "effect";
import { defineWorker } from "renkin/worker";
import { Cache } from "./resources.ts";

export default defineWorker({ CACHE: Cache }, ({ CACHE }) => ({
  fetch: (request) => Effect.gen(function* () {
    if (request.method === "PUT") {
      yield* CACHE.put("message", yield* Effect.promise(() => request.text()));
    }
    return new Response(yield* CACHE.get("message"));
  }),
}));

// renkin.ts
import { defineStack } from "renkin";
import { worker } from "renkin/cloudflare";
import { Cache } from "./resources.ts";

export default defineStack({
  name: "messages",
  resources: [Cache, worker("api", {
    entry: new URL("./worker.ts", import.meta.url).pathname,
    compatibilityDate: "2026-07-30",
  })],
});
```

The factory receives resolved clients and runs once per Worker environment. Its
handlers and third-party adapters can close over them without passing a runtime
context or adding a second bindings/layers list. An unrelated Effect service still
requires an application layer as the third `defineWorker` argument; missing Effect
requirements remain type errors. Ordinary standard Worker handlers also work.

KV clients provide Effect `get`, `getJson<T>`, `put`, `delete` and `list` operations.
`CACHE.native` is the actual `KVNamespace`, with Cloudflare's official type surface,
for ordinary Promise code and native adapters. Native operations retain provider
errors; Effect methods return a `BindingError` containing only binding and operation
names. The installed workerd integration tests exercise JSON/metadata, options,
bulk reads, list/delete, hot reload and persistence. These checks do not promise
that every future Cloudflare feature is available in the pinned local emulator.

Local development uses one workerd graph. KV data persists beneath the selected
state directory, separated by stack/environment and stable physical IDs. Stopping
and restarting development, reloading Worker source, or explicitly renaming the
logical KV ID preserves data. Local development uses no provider credentials.

## Worker references and ownership

Declare `workerReference("api")` in the implementation requirements to call another
Worker from the same stack. `client.native.fetch(...)` uses its native fetch binding;
`client.call(service => service.fetch(...))` wraps the Promise in Effect. Typed named
entrypoints use `workerReference<Service>("api", { entrypoint: "Service" })`, where
the target exports a Cloudflare `WorkerEntrypoint` subclass with that name.
Requirements on the default `defineWorker` implementation supply `this.env` bindings
to named entrypoints in the same module. Worker A and Worker B may reference each
other; these binding references are separate from provisioning dependencies.

Every managed reference must name a declared resource of the expected type.
Undeclared references fail before provisioning. Renkin provisions all Worker targets,
including named entrypoint placeholders, then publishes the complete graph. A
replacement redirects callers before removing the previous Worker.

Use `externalWorker("physical-script-name", { entrypoint: "Service" })` for a
separately owned Worker, such as a permanent service used by preview environments.
For credential-free development, supply `localEntry` with its local implementation.
The consuming stack never acquires ownership of the external Worker and cannot
update or delete it. Its owning stack controls its lifecycle.

Cleanup detaches only callers in the same owned environment, after verifying both
their ownership tag and recorded configuration hash. A caller changed outside Renkin
fails closed. Bindings from another owner's Worker are left untouched and can block
Cloudflare deletion. Renkin deliberately does not use the provider's `force` deletion
option, which can also delete associated Durable Objects and bindings. This is a
constraint for future Durable Object lifecycle work as well.

## Protection, retention and rename

KV is protected by default, including an empty namespace. The whole plan is checked
before any provider mutation: a rejected protected deletion or replacement also
prevents unrelated creates/updates in that plan. `--yes` and `--force` do not bypass
protection. Set `kv("Cache", { allowDelete: true })` explicitly before disposal, or
include that permission in a desired replacement. Changing jurisdiction changes
identity and requires replacement permission; it never repurposes the previous
namespace ID. Common core protection also supports future data-bearing resources.

`retain: true` keeps the provider object and explicitly drops Renkin's ownership
record. It is different from protection, which rejects a destructive plan while
preserving ownership. Retained objects require a deliberate separate ownership or
manual maintenance plan.

For a logical rename, change the declaration and implementation reference together:

```ts
defineStack({
  name: "messages",
  renames: [{ from: "Cache", to: "Messages" }],
  resources: [kv("Messages"), /* Worker declarations */],
});
```

The rename is an explicit same-stack/environment/type/identity migration, preserves
the provider ID and data, and atomically rewrites saved dependencies and references.
It does not infer names or move ownership between environments. Collisions,
ambiguous mappings and type/identity changes fail. Recovery retains the original
ownership proof and retries an already committed rename safely. An interrupted
unrelated deployment must be recovered before starting a new rename.

Cloud state journals server-assigned KV IDs before binding Workers, and keeps pending
binding and removal progress through interruption. Ordinary client failure is
retryable. The exceptional ambiguous coordinator/provider-dispatch boundary follows
[ADR 0007](adr/0007-reconcile-ambiguous-provider-operations-explicitly.md); it never
turns uncertainty into an empty environment or blindly repeats an unknown mutation.

Implementation requirements are read from inert metadata in a bounded, credential-free
workerd isolate with outbound requests denied. The handler factory is not invoked for
inspection. Module initialization must be compatible with workerd. This inspection
uses the installed emulator's supported date; the declared deployment compatibility
date is preserved for Cloudflare.

See [Worker commands and state setup](worker-first-slice.md) and the
[ticket #5 validation record](validation/issue-5.md). These are workspace APIs;
packed-package consumer validation remains the release ticket.
