# Assets, domains and Access

Import resource constructors from `renkin/cloudflare` and the build contract from
`renkin`. A framework adapter or external build command can produce a
`WorkerBuildResult`; its entry must already be an ES module. Renkin reads the
artifact before planning and uploads those captured bytes without rebundling.

```ts
import { defineStack, type WorkerBuildResult } from "renkin";
import {
  accessApplication, accessPolicy, accessServiceToken, customDomain, worker,
} from "renkin/cloudflare";

const build: WorkerBuildResult = {
  entry: "dist/worker.mjs",
  assets: {
    directory: "dist/client",
    config: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
  },
  compatibilityDate: "2026-07-30",
};
const token = accessServiceToken("automation", { name: "automation", duration: "24h" });
const policy = accessPolicy("automation-policy", {
  name: "automation", decision: "non_identity", serviceTokens: [token],
});
const access = accessApplication("access", {
  name: "site", domain: "site.example.com", policies: [policy],
  eagerRedirectCookieSetting: true,
  corsHeaders: {
    allowedOrigins: ["https://frontend.example.com"],
    allowedMethods: ["GET", "OPTIONS"], allowCredentials: true,
  },
});
const site = worker("site", {
  build, compatibilityDate: "2026-07-30", workersDev: false, dependencies: [access],
});
export default defineStack({
  name: "site",
  resources: [token, policy, access, site, customDomain("domain", {
    hostname: "site.example.com", zoneId: "your-zone-id", worker: site, access,
  })],
});
```

Asset directories support `.assetsignore`, `_headers`, `_redirects`, HTML routing,
404 fallback, SPA fallback and Worker-first route patterns. Additional ES, text,
binary and WASM modules are relative to the entry directory. Module paths cannot
escape that directory; asset symlinks are rejected. Individual assets are limited
to 25 MiB. Build compatibility settings override the Worker defaults.

Access applications currently support `self_hosted`. Referencing tokens in a
policy and policies in an application establishes their provisioning order and
resolves their provider IDs. Omitted application fields preserve the fresh
provider observation. Supplied CORS fields merge into observed CORS settings;
explicit false values are retained. Supplying an empty policy array clears the
application's policies; omitting policies preserves them.

A protected custom domain must refer to its Access application, and its Worker
must disable `workersDev`. Renkin verifies application coverage before publishing
the domain and disables Worker preview URLs. A private Worker closes these
alternate origins before uploading application code; a failed closure prevents
publication. Resource ownership is checked before
updates or deletion. Replacing a managed Worker moves its existing owned domain
to the replacement. Cloudflare automatically issues the domain certificate;
[Cloudflare documents that deleting a domain does not remove its certificate](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#certificates).
Certificate inventory and cleanup require separate zone SSL permissions. Renkin
currently removes the Worker domain record, not certificates shared by the zone.

Service-token outputs are encrypted in deployed state and redacted by default
when reading outputs. Explicitly requesting secret outputs reveals the client ID
and secret. A durable encrypted response receipt preserves a newly generated
secret if the client loses the successful response. The receipt is acknowledged
atomically with the matching state checkpoint. If the provider created a token
but no recoverable receipt exists, Renkin stops instead of silently rotating it.
An unknowable provider mutation still requires the explicit reconciliation
workflow described in ADR 0007.

`observabilityDestination` creates an OpenTelemetry logpush destination with a
URL, dataset, optional headers and enabled flag. Its output `slug` can be supplied
in Worker `observability.logs.destinations` or `observability.traces.destinations`.
Destinations are compared against fresh paginated provider observations; changes
to enabled, URL and headers update the same destination. Dataset or ownership
identity changes require replacement. Worker settings support trace sampling,
log invocation settings and query-string redaction. A destination's endpoint
must accept Cloudflare's validation request before creation.

`development` runs external builds and native assets without Cloudflare
credentials, including rebuild reloads. The same stack may declare Access, domain
and observability resources: local execution skips those control-plane operations
and does not create service-token credentials. Local HTTP remains unauthenticated. Local execution does not emulate Access
login, Access service-token enforcement, custom-domain DNS or TLS issuance,
OpenTelemetry export delivery, or third-party OAuth redirects and provider
callbacks. Validate those flows separately in an authorized cloud environment.
Local callbacks can use a locally reachable URL only when the third-party
provider supports it; Renkin does not bypass provider redirect restrictions.
