# Durable Objects

`@carere/renkin/cloudflare` declares owned SQLite Durable Object namespaces. `@carere/renkin/durable-object`
provides a native workerd class base with inferred Renkin bindings. `@carere/renkin/testing`
provides a scoped application restart fixture. Application code uses real namespace
IDs, RPC stubs, SQLite, key-value storage and alarms in both local and cloud execution.

Keep the resource descriptor in a shared module. Import implementation classes as
types so infrastructure evaluation does not load `cloudflare:workers` in Node or Bun.

```ts
// resources.ts
import { durableObject } from "@carere/renkin/cloudflare";
import type { Counter } from "./api.ts";

export const counters = durableObject<Counter>("Counters", {
  worker: "Api",
  className: "Counter",
});
```

```ts
// api.ts
import { defineDurableObject } from "@carere/renkin/durable-object";
import { defineWorker } from "@carere/renkin/worker";
import { counters } from "./resources.ts";

export class Counter extends defineDurableObject({}) {
  async increment() {
    const value = (await this.ctx.storage.get<number>("value") ?? 0) + 1;
    await this.ctx.storage.put("value", value);
    return { value, id: this.ctx.id.toString() };
  }
}

export default defineWorker({ COUNTERS: counters }, ({ COUNTERS }) => ({
  fetch: () => COUNTERS.call(async (namespace) =>
    Response.json(await namespace.getByName("main").increment())),
}));
```

```ts
// renkin.ts
import { defineStack } from "@carere/renkin";
import { worker } from "@carere/renkin/cloudflare";
import { counters } from "./resources.ts";

export default defineStack({
  name: "counter-app",
  resources: [
    counters,
    worker("Api", { entry: "./api.ts", compatibilityDate: "2026-07-30" }),
  ],
});
```

The descriptor's `worker` names its owning Worker. `className` must be the named
class export in that Worker's code. Named class metadata and default Worker metadata
are inspected without calling constructors or application handlers. Class bindings
are available as `this.bindings`; `this.ctx` and `this.env` remain native objects.
`DurableObjectState` and `DurableObjectStorage` types are available from
`@carere/renkin/durable-object` and use Cloudflare's installed official definitions.

`COUNTERS.native` is the native typed namespace. It exposes `idFromName`,
`idFromString`, `newUniqueId`, `get`, `getByName` and jurisdiction/location options.
`COUNTERS.call` lifts an asynchronous native namespace operation into an Effect.
Within a class, use `this.ctx.storage.sql`, storage transactions, `setAlarm`,
`getAlarm`, `deleteAlarm`, and an ordinary `alarm()` method. Renkin does not replace
storage or alarm execution. Native alarms can retry; application handlers should
account for repeated delivery.

## Restart and persistence checks

```ts
import { Effect } from "effect";
import { development } from "@carere/renkin";
import { applicationFixture } from "@carere/renkin/testing";
import stack from "./renkin.ts";

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const fixture = yield* applicationFixture(() => development(stack, {
    directory: ".renkin/counter-test",
    watch: false,
  }));
  const currentWorker = () => {
    const api = fixture.current.workers.Api;
    if (!api) throw new Error("Missing Api Worker");
    return api;
  };
  const first = yield* Effect.promise(() => currentWorker().fetch());
  const before = yield* Effect.promise(() => first.json());
  yield* fixture.restart;
  const next = yield* Effect.promise(() => currentWorker().fetch());
  const after = yield* Effect.promise(() => next.json());
  if (before.id !== after.id || after.value !== before.value + 1)
    throw new Error("Native identity or persistence changed.");
})));
```

The fixture closes and recreates the actual scoped application. Keep its persistence
directory stable and obtain the current session again after restart. A failed restart
leaves no running session; correcting the configuration and running `restart` again
reopens the same persisted data. The outer Effect scope closes the final session.
The caller owns persistence-directory cleanup. No runtime internals or fake storage
engine are needed by the application test.

## Ownership, migrations and deletion

A namespace and its owning Worker have data protection, including an empty namespace.
Removing either or changing its physical identity requires explicit `allowDelete`.
The namespace flag does not grant permission to delete the Worker. Deploy disposable
flags on both declarations before `removeEnvironment`; other protected resources in
the environment need their own flags. `--force` does not grant deletion permission.

An explicit stack `renames` entry can move a logical namespace ID while preserving
the allocation and storage. Update binding descriptors to the new logical ID too.
To rename the native class without replacing its storage, rename the code export and
set `className: "NewCounter", renamedFrom: "Counter"` on the same resource. Keep that
migration declaration. If multiple later class renames are planned, set a stable
explicit `identity` on the initial declaration and preserve it for every rename,
naming the immediately preceding class in `renamedFrom`. Cloudflare's
[class lifecycle documentation](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
describes an alias-based, three-deployment rollout when uninterrupted traffic matters.

Renkin publishes declarative `exports` for application namespaces. It does not change
the state backend's legacy migrations. It records the authoritative namespace ID
after publication and persists it with the successful binding checkpoint. A later
missing or replaced namespace fails ownership checks rather than being silently
recreated or adopted. A failed binding/checkpoint remains recoverable and protected;
retry the same desired stack after correcting the cause.

Class removal from a retained Worker requires removing its code export and bindings.
Renkin emits a deletion tombstone only with an explicit authorization for the exact
owned namespace ID and owning Worker. A namespace retained with `retain: true` cannot
be deleted by a later Worker update. Retain its owner too when leaving an environment;
remaining namespaces block Worker deletion. Foreign classes and external references
are never force-deleted. Adoption, cross-Worker class transfers and namespace storage
backend conversion are not provided by this API.

Self-bindings are supported. Another Worker can bind the same declared namespace;
publication orders the owner before namespace verification and consumers. Arbitrary
mutual cross-namespace provisioning cycles fail preflight. Ordinary mutual Worker
service calls continue to use the separate Worker-reference mechanism.

## Validation

Local public integration tests cover native SQLite/key-value data, typed RPC, alarms
across process restart, logical/class renames, and failed protected changes followed
by recovery. Core integration tests interrupt the actual file-state write after
binding and verify that returned outputs become durable only with the checkpoint.
HTTP-boundary tests cover foreign/retained namespace fences and namespace incarnation
changes. Separately invoked credentialed tests use the real Cloudflare API for class
addition, rename, redeployment, alarms, interruption recovery and owned cleanup.
