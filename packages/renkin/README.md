# Renkin

Renkin is an Effect-based Cloudflare infrastructure toolkit for Bun on macOS and
Linux. One package provides infrastructure definitions, native Worker bindings,
credential-free local development, framework builds, testing helpers and a JSON CLI.

This is a release candidate. Building and validating its tarball does not publish it
or establish that a package-registry release exists.

```sh
bun add ./renkin-0.0.0.tgz effect@^4.0.0-rc.115
bun x renkin help
```

Run consumer scripts with Bun. Node.js and Windows are not supported deployment or
local-development runtimes. Effect remains an external compatible peer; do not
install a second incompatible Effect runtime beside the application.

## Public entrypoints

| Import | Purpose |
| --- | --- |
| `renkin` | Stack, deployment, development, inspection, recovery and build-command APIs |
| `renkin/cloudflare` | Cloudflare resources, explicit configuration and shared state |
| `renkin/worker` | Typed binding requirements and native/Effect Worker composition |
| `renkin/testing` | Scoped application, HTTP, queue, Workflow, email and Durable Object fixtures |
| `renkin/durable-object` | Native workerd Durable Object class helpers |
| `renkin/workflow` | Native workerd Workflow class helpers |
| `renkin/vite` | TanStack Solid SPA/SSR Vite plugin and build helper |
| `renkin/astro` | Astro CLI integration, programmatic build helper and configuration types |

Durable Object and Workflow runtime entries belong inside Workers executed by
workerd; importing them into an ordinary Bun host process is not a runtime test.
TypeScript projects should use `moduleResolution: "Bundler"` and `skipLibCheck: true`
with the supported framework dependencies. Application types and Effect requirements
remain checked. The release validation record explains the upstream Astro declaration
closure separately from Renkin's declarations.

## Astro builds

Use `renkin(site)` from `renkin/astro` in `astro.config.ts`:

```ts
import { defineConfig } from "astro/config";
import { renkin } from "renkin/astro";
import { site } from "./renkin.ts";
export default defineConfig({ integrations: [renkin(site)] });
```

Run `bunx --bun astro build`. Astro compiles the site and the integration writes
`.renkin/build-result.json`; no custom `build.ts` is required. The integration owns
the Cloudflare adapter. `buildAstro(site)` remains available for programmatic use.
The [repository README](https://github.com/carere/renkin#readme) is the primary
usage guide, including stack declarations, development, deployment and bindings.

## Usage guides

- [Workers, explicit authentication, state and CLI](docs/agents/worker-first-slice.md)
- [Connected Workers, KV and lifecycle protection](docs/agents/connected-workers.md)
- [SQL and Drizzle migrations](docs/agents/d1-migrations.md)
- [R2, application-signed S3 and previews](docs/agents/r2-and-previews.md)
- [Queues, schedules, Workflows and email](docs/agents/background-jobs.md)
- [Durable Objects, alarms and persistence](docs/agents/durable-objects.md)
- [Assets, custom domains and Access](docs/agents/sites-and-access.md)
- [TanStack Solid applications](docs/agents/tanstack-sites.md)
- [Astro static and server-rendered applications](docs/agents/astro-sites.md)
- [Build reuse and external Moon/Bun commands](docs/agents/build-reuse.md)
- [The five-service, three-frontend validation graph](docs/agents/full-graph.md)

Cloud configuration is explicit. Renkin does not implicitly select a Wrangler profile
or a global provider account. Local development and public fixtures need no provider
credentials; real-cloud tests are separate and create only explicitly authorized
resources. Check deletion protection and the recovery plan before destructive work.
Never place provider tokens in application source or browser-visible bindings.

Apache-2.0 licensing, source references and external dependency notices are included
in `LICENSE`, `NOTICE`, `SOURCE_PROVENANCE.md` and `THIRD_PARTY_NOTICES.md`.
`BUILD_INFO.json` identifies the assembled source revision and whether that checkout
was dirty; the adjacent release validation record identifies the exact tarball digest.
