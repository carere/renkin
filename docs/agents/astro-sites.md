# Astro sites

Renkin supports Astro static sites and server-rendered Workers through the public
`renkin/cloudflare` factory. Astro 7.3.3 and `@astrojs/cloudflare` 14.3.2 are the
validated versions. The official adapter builds and prerenders pages in workerd;
Renkin deploys the resulting modules, assets and native bindings.

```ts
import { defineStack } from "renkin";
import { astro, customDomain, kv } from "renkin/cloudflare";

const content = kv("content");
const site = astro("site", {
  root: import.meta.dirname,
  output: "server", // "static" generates only static routes and assets
  compatibilityDate: "2026-07-30",
  bindings: { CONTENT: content, GREETING: "Hello" },
  config: { site: "https://example.com", trailingSlash: "never" },
});
export default defineStack({ name: "website", resources: [
  site,
  customDomain("domain", { hostname: "example.com", zoneId: "your-zone-id", worker: site }),
] });
```

Ordinary resource definitions supplied as bindings are included as dependencies.
`cloudflare:workers` supplies native bindings during SSR and local development.
String bindings are ordinary Worker configuration. Keep secret values out of
source files; the existing secret credential binding and state rules also apply
to framework Workers.

## Sessions and data protection

Server output enables an ordinary protected KV namespace named `<site-id>-session`
and binds it as `SESSION`. Long resource IDs use a deterministic shortened name.
`site.sessionKV` exposes the generated definition. Deleting the site or disabling
sessions cannot silently delete this data: the usual retention and `allowDelete`
checks apply. `allowDelete: true` on the site also opts its generated session KV
into deletion; use this only for disposable data. Explicitly supplied namespaces
keep their own protection settings.

To reuse a namespace, set `sessionKVBindingName: "VISITS"` and
`bindings: { VISITS: kv("visits") }`. To disable sessions, set
`sessionKVBindingName: false`. Static output never creates a session namespace.
The `session` option accepts Astro cookie and TTL configuration. Renkin owns the
session driver and adapter configuration; configure sessions at this resource
boundary so the provisioned resources match the runtime.

## Build and development

Run `bun moon run example-static:dev` from this
checkout. These tasks use public `renkin dev`. Programmatic `development(stack)`
also discovers framework recipes. The Astro development server handles source
reload; a single Renkin Miniflare 4 graph owns local native storage and persistent
state. No Cloudflare login is required. Development uses request-scoped bindings
and a native KV session driver; it does not start the official adapter's separate
Miniflare 5 storage graph. Configure a frontend port with `port: 4321` or
`config: { server: { port: 4321 } }`; the resource port takes precedence. Native file watching is the default; explicit
Vite `server.watch.usePolling` is available for environments without native events.

Configure `integrations: [renkin(site)]` in `astro.config.ts`, importing `renkin`
from `renkin/astro` and the original site declaration from your infrastructure module.
Then `bun --bun astro build` produces `dist/` and `.renkin/build-result.json` without
a custom build script. The example Moon build task runs that same Astro CLI.
Renkin owns the Cloudflare adapter; do not also configure another adapter.
See the [README example](../../README.md). `buildAstro(site)` from `renkin/astro` returns the
shared `WorkerBuildResult`, including native requirement metadata, without
provisioning infrastructure. Deploying the resource invokes this builder
automatically. Existing explicit Worker build artifacts and custom domains use
the same deployment pipeline. Shared build caching is a separate capability.

The ordinary `astro.config.ts` remains supported; `configFile` can select another
file or disable discovery. `config` forwards Astro configuration, including base,
site, output directories, routing, integrations, and Vite plugins/source-map
hooks. `assetRouting` controls the shared Worker asset routing. Renkin generates
the official adapter's private `configPath`; no second user-maintained Wrangler
configuration is needed. Project roots are canonicalized, and official Astro
builds run sequentially within a process because overlapping prerender dispatchers
in the verified adapter conflict. Generated adapter files are private build
metadata and are excluded from public assets.

Production page generation defaults to workerd. High-level resources are attached
**after** that phase: a prerendered page cannot read the site's D1, R2 or KV
bindings. Use server-rendered routes for resource access. An explicit
`prerenderEnvironment: "node"` fallback is supported when a build needs Node page
generation; it does not claim workerd compatibility. Worker compatibility flags
and dates remain explicit. SSR modules are returned without flattening the
adapter's module graph, including its Wasm or text modules.

## Validation

The static example checks actual workerd generation, navigation and asset headers.
The package-owned SSR fixture checks dynamic routes, native KV, cookie sessions and prerendered
pages. Owning package tests cover default/existing/disabled sessions, persistence,
source reload, base paths, Node fallback, styled components through symlinked
roots, and concurrent build requests. Run these without credentials:

```sh
bun moon run websites:test-integration renkin:test-integration
bun moon run example-static:test-integration renkin:test-astro
```

The separately invoked `packages/renkin/tests/cloud/root/astro.test.ts` requires
explicit current cloud test authorization. It uses unique temporary names and an
exact hostname, tests both outputs and all session modes, then removes owned
resources and the empty environment. Cloud credentials are never needed by the
normal suite.

### Bun build transport compatibility

[Bun 1.4.2's built-in `undici` replacement](https://bun.com/docs/runtime/module-resolution#built-in-replacements-for-npm-packages) ignores HTTP dispatchers. Cloudflare's
official build runtime requires them to preserve Worker dispatch semantics. Renkin
registers a loader for only that resolved Miniflare 5 CommonJS file before loading
the official framework plugins. It evaluates the installed source with its original
filename and relative dependency paths, mapping that module's `undici` import to
npm's actual `undici/index.js`. It changes neither global fetch, installed files,
nor the application's Miniflare 4 runtime. Inline configuration hooks and workerd
page generation remain in the caller's process.

This compatibility bridge recognizes the verified Miniflare 5 builds
`5.20260918.0-alpha` and `5.20260921.0-alpha` and checks their module shape. An
unrecognized build fails explicitly instead of silently changing transport. Remove
the bridge once Bun's documented replacement honors the dispatcher contract, after
the real-workerd positive/negative transport regression and installed macOS/Linux
framework checks pass. Prerender HTTP server errors always fail the build; their
HTML cannot become a successful static asset.
