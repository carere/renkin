# TanStack Start Solid sites

The executable [SPA](../apps/example-spa) and [SSR](../apps/example-ssr) examples
use the public API. Both run without provider credentials for development and
production-build validation. The supported Renkin host is Bun.

Declare a site once and import it into the stack and Vite configuration:

```ts
// resources.ts
import { kv, tanstackStart } from "renkin/cloudflare";
export const site = tanstackStart("Site", {
  root: import.meta.dirname,
  rendering: "ssr", // "spa" prerenders the client shell into index.html
  compatibilityDate: "2026-07-30",
  port: 3102,
  bindings: { DATA: kv("Data"), STAGE: "development" },
  sourceMap: true,
  buildEnvironment: { VITE_APPLICATION: "My application" },
});
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { renkin } from "renkin/vite";
import { site } from "./resources.ts";
export default defineConfig({ plugins: [renkin(site)] });
```

```ts
// renkin.ts
import { defineStack } from "renkin";
import { site } from "./resources.ts";
export default defineStack({ name: "my-site", resources: [site] });
```

`bindings` accepts constants and native resource descriptors. Owned descriptors
are added to the resource graph once; conflicting declarations fail before
provisioning. Import `env` from `cloudflare:workers` in server code and use its
native methods, with a project declaration for the binding types. Client code
must not read server bindings. No runtime layer or binding wrapper belongs in
the consuming route. KV/D1/R2 and the other supported descriptors use the same
native local graph as ordinary Workers. Service binding references keep their
normal ownership and cross-stack rules.

The local bridge gets fresh handles for each request and keeps them active for
registered `waitUntil` work. Accessing the bridge's `env` outside a request fails.
Development SSR runs in Bun, while built SSR and cloud deployment run in workerd;
validate production artifacts as well as development. Local Access enforcement
is not simulated. Presigned local R2 URLs use the browser origin and are dispatched
to the native signature-verifying gateway before SPA routing.

## Build and routing options

`root` selects the application directory independently of the stack's working
directory. `configFile` and `serverEntry` resolve from that root. The SSR example
includes a custom server entry and response header. `port` selects the local Vite
port; a conflict fails instead of silently moving to another port. Normal Vite
configuration remains available for framework-specific settings.

`sourceMap` accepts Vite's boolean, `"inline"`, or `"hidden"` settings.
`compatibilityDate` and `compatibilityFlags` configure the production build and
Worker; flags default to `nodejs_compat`. `beforeBuild` runs before compilation;
`afterBuild(result)` sees the raw framework artifact and can validate or amend
its files before Renkin attaches resource-specific binding metadata. Exceptions
from either hook stop the build.

Production builds run in a child Bun process with `--no-env-file` and a small OS
environment allowlist. Only explicit `buildEnvironment` values are added; cloud
provider credentials are not inherited. Vite still follows its normal application
`.env` file behavior, so never put provider secrets in frontend `VITE_*` values or
explicit build variables. CLI diagnostics go to stderr, leaving successful JSON
results on stdout. Programmatic callers retain their own logging policy.

SPA builds use the official plugin's prerender preview to emit `index.html`.
Assets default to single-page fallback, with `/_serverFn/*` and `/api/*` routed to
the Worker first. SSR defaults to ordinary asset lookup followed by Worker
rendering. Override `assets` with the existing `AssetRouting` fields for custom
routing. Native Worker options, including observability, `workersDev` and
publication dependencies, are available on the site resource.

Custom domains compose through `customDomain("Domain", { worker: site, hostname,
zoneId })` in the stack. For a protected site, use the existing Access application
and policy resources, pass `access` to the domain, disable `workersDev`, and make
the site depend on that Access application. Domain and Access behavior is shared
with ordinary Workers.

`buildTanStack(site)` from `renkin/vite` returns the public `WorkerBuildResult`,
including the binding metadata wrapper, modules and asset directory. Host build
and development modules load by file URL so ordinary Worker bundlers do not
traverse Vite or native tooling; release packaging must retain those module files
and the build subprocess entry alongside their declarations. It can be
passed to `worker("Site", { build, ... })` for a separately built artifact. Keep
the site's dependency declarations and constants when doing that. No bundler or
upload-specific type is required of external builders. Automatic cache reuse is
not implemented by this ticket.

## Run and verify

From either example directory:

```sh
bun x --no-install renkin dev --file renkin.ts
bun x --no-install vitest run --project integration
```

From the repository root, `bun moon run websites:test-integration
example-spa:test-integration example-ssr:test-integration` runs native bridge and
browser checks. Install the browser once with `bun x playwright install chromium`.
The app suites execute the public APIs in Bun and use Chromium to verify hydration,
client navigation and source reload, then build and serve in native workerd while
preserving KV data. They exercise source maps, build variables, hooks, SPA fallback,
static assets and the SSR custom entry. Native S3 tests verify signed browser-origin
PUT/GET requests and rejection of modified signatures.

The separate authorized cloud suite is
`packages/renkin/tests/cloud/root/tanstack.test.ts`, run with that package's
`vitest.cloud.config.ts`. It requires the existing cloud test authorization flags,
expiry, prefix, account, domain and zone environment values. It deploys temporary
SPA/SSR Workers and KV, checks assets/native calls/SSR/custom-domain routing, then
removes the exact environments. Normal CI does not run it.

Validated dependency frontier: TanStack Solid Start 1.168.54, Solid Router 1.170.36,
Solid 1.9.15, Vite 8.3.0, vite-plugin-solid 2.11.14, Cloudflare Vite plugin 1.56.0.
Exact dependency resolutions live in `bun.lock`. This is source-workspace
validation; packaged installation and publication remain the release task.

## Validation recorded on 2026-09-21

All 183 tests across the 11 populated provider-free Moon suites passed, together
with TypeScript, Biome, Knip, manifest sorting and Moon synchronization. The
strengthened SSR browser scenario also passed separately after adding navigation
back to its native-data server-function route. Manual `agent-browser` checks
covered both running examples' hydration, navigation and source reload.

The separate real-Cloudflare SPA and SSR scenarios then passed through the public
`deploy` API using the configured account and test domain:

| Environment | Observed behavior | Cleanup |
| --- | --- | --- |
| `renkin-test-spa-1485a997/framework` | Prerendered page, client JavaScript, static asset, native KV POST/GET and SPA fallback | Worker and KV removed; environment removal completed |
| `renkin-test-ssr-76e5dcb4/framework` | SSR markup, custom server-entry header, native KV POST/GET, client JavaScript and static asset; custom-domain TLS and native-data GET after propagation | Custom domain, Worker and KV removed; environment removal completed |

The custom hostname was the SSR environment's stack name beneath the configured
test domain. No email, paid certificate purchase or backend upgrade was performed.
Any retained managed-certificate inventory is recorded by the umbrella task's
cleanup audit; successful domain removal does not assert deletion of a separate
certificate pack.

Two earlier failed SPA scopes, `renkin-test-spa-903b8794/framework` and
`renkin-test-spa-492720b0/framework`, were also removed. The first exposed executable
builder callbacks entering durable state; the second was interrupted by a test
trace's consumed-Request bug and was recovered through public removal. The durable
boundary now projects only `ResourceDefinition` fields, with a local regression
covering build hooks, deploy, unchanged repeat and removal. Neither initial attempt
is counted as a passing cloud test.

Development optimizer files belong to each Worker/environment's local development
folder. Renkin canonicalizes that path and the application root; it owns Vite's
`cacheDir` during `development()` so multiple frontends cannot overwrite one another's
optimizer metadata. Production Vite configuration remains separate.

The Renkin Vite plugin prediscovers its known Router browser dependencies. Applications
with other source-distributed libraries can use normal Vite `optimizeDeps.include`
settings, including nested dependencies (for example
`"@tanstack/solid-query > @tanstack/query-core"`). The full-graph example declares this
optional Query dependency explicitly. This avoids cold-load stale optimizer URLs
without disabling Vite's stale-module checks or relying on browser reload retries.
