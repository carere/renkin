import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
  SendEmail,
} from "@cloudflare/workers-types";
import { expectTypeOf, it } from "@effect/vitest";
import {
  astro,
  d1,
  durableObject,
  email,
  kv,
  queue,
  r2,
  r2Token,
  type SiteEnvironment,
  tanstackStart,
  workflow,
} from "renkin/cloudflare";
import { workerReference } from "renkin/worker";

const site = tanstackStart("Site", {
  root: ".",
  rendering: "ssr",
  compatibilityDate: "2026-09-22",
  bindings: {
    DATA: kv("Data"),
    OBJECTS: durableObject("Objects", { worker: "Worker", className: "Object" }),
    CREDENTIALS: r2Token("Credentials", {
      buckets: [r2("Bucket")],
      permissions: "read-only",
      expiresAt: "2030-01-01T00:00:00Z",
    }),
    DB: d1("Database"),
    BUCKET: r2("Bucket"),
    MAIL: email(),
    STAGE: "development",
    JOBS: queue<{ id: string }>("Jobs"),
    FLOW: workflow<{ id: string }>("Flow", { worker: "Worker", className: "Flow" }),
    SERVICE: workerReference<{ greet(name: string): Promise<string> }>("Service"),
  },
});

type Env = SiteEnvironment<typeof site>;
it("infers native handles and preserves binding names and application payload types", () => {
  expectTypeOf<Env["DATA"]>().toEqualTypeOf<KVNamespace>();
  expectTypeOf<Env["OBJECTS"]>().toEqualTypeOf<DurableObjectNamespace>();
  expectTypeOf<Env["CREDENTIALS"]>().toEqualTypeOf<string>();
  expectTypeOf<Env["DB"]>().toEqualTypeOf<D1Database>();
  expectTypeOf<Env["BUCKET"]>().toEqualTypeOf<R2Bucket>();
  expectTypeOf<Env["MAIL"]>().toEqualTypeOf<SendEmail>();
  expectTypeOf<Env["STAGE"]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<Env["JOBS"]["send"]>[0]>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<NonNullable<Parameters<Env["FLOW"]["create"]>[0]>["params"]>().toEqualTypeOf<
    { id: string } | undefined
  >();
  expectTypeOf<Env["SERVICE"]["greet"]>().toEqualTypeOf<(name: string) => Promise<string>>();
  // @ts-expect-error Undeclared binding names must not be accepted.
  expectTypeOf<Env["MISSING"]>();
  // @ts-expect-error Native handles must not be replaced by Effect clients.
  expectTypeOf<Env["DATA"]["native"]>();
});

const options = { root: ".", compatibilityDate: "2026-09-22" };
const server = astro("Server", { ...options, output: "server", bindings: { DATA: kv("Data") } });
const custom = astro("Custom", { ...options, output: "server", sessionKVBindingName: "SESSIONS" });
const disabled = astro("Disabled", { ...options, output: "server", sessionKVBindingName: false });
const staticSite = astro("Static", { ...options, output: "static" });
it("infers Astro session bindings only when enabled with their configured names", () => {
  expectTypeOf<SiteEnvironment<typeof server>["SESSION"]>().toEqualTypeOf<KVNamespace>();
  expectTypeOf<SiteEnvironment<typeof server>["DATA"]>().toEqualTypeOf<KVNamespace>();
  expectTypeOf<keyof SiteEnvironment<typeof custom>>().toEqualTypeOf<"SESSIONS">();
  expectTypeOf<SiteEnvironment<typeof custom>["SESSIONS"]>().toEqualTypeOf<KVNamespace>();
  expectTypeOf<keyof SiteEnvironment<typeof disabled>>().toEqualTypeOf<never>();
  expectTypeOf<keyof SiteEnvironment<typeof staticSite>>().toEqualTypeOf<never>();
});
