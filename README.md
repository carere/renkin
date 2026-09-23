# Renkin

Renkin is an Effect-based infrastructure toolkit for Cloudflare. Declare Workers,
storage and websites in TypeScript, run the application locally without cloud
credentials, and deploy named environments from the same definitions.

It supports Workers and service bindings; D1, KV and R2; queues, Workflows,
Durable Objects and email; Access, custom domains and assets; TanStack Start with
Solid (SPA/SSR); and Astro (static/SSR). Use Bun on macOS or Linux. Node.js and
Windows are not supported Renkin execution environments.

## Install

Once published, install the single public package and its Effect peer:

```sh
bun add @carere/renkin "effect@^4.0.0-rc.115"
```

For an unpublished release candidate, replace `@carere/renkin` with the path to its staged
`.tgz` artifact. Internal `@renkin/*` workspaces are not consumer dependencies.
Framework applications also install their usual Astro or TanStack dependencies.

## Your first Worker

Keep the Worker implementation separate from infrastructure configuration:

```ts
// worker.ts
export default {
  fetch() {
    return new Response("Hello from Renkin");
  },
};
```

```ts
// renkin.ts
import { defineStack } from "@carere/renkin";
import { worker } from "@carere/renkin/cloudflare";

export default defineStack({
  name: "hello",
  resources: [worker("api", {
    entry: new URL("./worker.ts", import.meta.url).pathname,
    compatibilityDate: "2026-07-30",
    port: 8787,
  })],
});
```

```sh
bunx --bun --package @carere/renkin renkin dev
```

The development command starts the local application graph, watches source changes
and keeps local data between restarts. No Cloudflare credentials are needed.
Local email is captured rather than sent. Local state lives under `.renkin/`;
exclude that directory from Git because it can contain secrets.

Effect handlers can use `defineWorker` from `@carere/renkin/worker`:

```ts
import { Effect } from "effect";
import { defineWorker } from "@carere/renkin/worker";

export default defineWorker({
  fetch: () => Effect.succeed(new Response("Hello from Effect")),
});
```

Pass an application layer as the second argument when handlers require services.
Missing Effect requirements are checked by TypeScript.

## Deploy and inspect environments

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment or an
ignored `.env` file. Use an API token with permissions for the resources you declare;
Renkin does not use browser login or saved Cloudflare profiles. The account needs
a workers.dev subdomain. The first deployment creates its shared encrypted state
backend automatically; developers and CI must select the same backend.

```sh
bunx --bun --package @carere/renkin renkin plan --env preview
bunx --bun --package @carere/renkin renkin deploy --env preview --yes
bunx --bun --package @carere/renkin renkin list --stack hello
bunx --bun --package @carere/renkin renkin outputs --stack hello --env preview
bunx --bun --package @carere/renkin renkin remove --stack hello --env preview --yes
```

`--file path/to/renkin.ts` selects another stack file. `list` and `outputs` emit
JSON without loading infrastructure code. Progress goes to stderr. Secret outputs
are redacted unless you explicitly use `--reveal-secrets`.

Data resources are protected from deletion and replacement by default. Use
`allowDelete: true` deliberately for disposable resources. Neither `--yes`
(skip confirmation) nor `--force` (rerun unchanged resources) bypasses protection.
Nonempty R2 buckets additionally require the explicit empty-and-delete option.
The shared state backend survives ordinary environment removal.

A competing deployment fails instead of changing an environment concurrently.
Interrupted deployments normally resume from their checkpoint. If a provider
operation has an unknowable outcome, `renkin inspect` reports the blocked operation;
[explicit reconciliation](docs/agents/worker-first-slice.md#reconcile-an-ambiguous-provider-operation)
is required after establishing its outcome. Resource recovery is not SQL rollback.

## Bind resources to application code

Declare resources once and use them in the Worker implementation. Renkin derives
binding requirements and deployment dependencies from that use:

```ts
// worker.ts
import { Effect } from "effect";
import { d1 } from "@carere/renkin/cloudflare";
import { defineWorker } from "@carere/renkin/worker";

export const database = d1("Database", { migrations: "./migrations" });
export default defineWorker({ DB: database }, ({ DB }) => ({
  fetch: () => Effect.gen(function* () {
    const row = yield* DB.first<{ count: number }>("SELECT COUNT(*) AS count FROM users");
    return Response.json(row);
  }),
}));
```

Include `database` and the Worker in the stack’s resources, using the Worker file
as `worker(..., { entry })`. Typed resource clients
also expose native handles, such as `DB.native`, for platform APIs and Drizzle.
D1 accepts plain SQL files or the supported Drizzle `meta/_journal.json` layout;
applied migration names are skipped. Do not edit an applied migration expecting it
to rerun—add a new migration instead.

## Secrets and generated resource outputs

Use `secret` with an environment variable **name**, not its value. Worker binding
strings remain ordinary `plain_text`; secret descriptors upload as Cloudflare
`secret_text`. The same bindings work on `worker`, `tanstackStart` and `astro`:

```ts
import { defineStack, output, resourceOutput, secret } from "@carere/renkin";
import { accessApplication, worker } from "@carere/renkin/cloudflare";

const access = accessApplication("ReviewAPI", {
  name: "review-agents",
  domain: "review.staging.example.com",
});
const lifecycle = accessApplication("ReviewLifecycleAPI", {
  name: "review-deployments",
  domain: "review.staging.example.com/v1/scopes",
});
const review = worker("Review", {
  entry: new URL("./worker.ts", import.meta.url).pathname,
  compatibilityDate: "2026-07-30",
  bindings: {
    ACCESS_AUDIENCE: resourceOutput(access, "aud", { local: "local-review" }),
    LIFECYCLE_AUDIENCE: resourceOutput(lifecycle, "aud", { local: "local-lifecycle" }),
    BETTER_AUTH_SECRET: secret("BETTER_AUTH_SECRET"),
    GOOGLE_CLIENT_ID: secret("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: secret("GOOGLE_CLIENT_SECRET"),
    POSTHOG_PERSONAL_API_KEY: secret("POSTHOG_PERSONAL_API_KEY"),
    PROBE_TOKEN: secret("PROBE_TOKEN"),
  },
});
export default defineStack({
  name: "review",
  resources: [review, access, lifecycle],
  outputs: { audience: output(resourceOutput(access, "aud", { local: "local-review" })) },
});
```

Add the Access policies appropriate to your application; this example focuses on
binding values. References automatically order Worker provisioning after their
targets. Include each referenced resource in the stack. Missing targets, wrong
resource types and dependency cycles fail validation. Missing output fields and
non-string Worker values fail before the final Worker upload. Output references
select a top-level provider field; they are supported in Worker bindings and in
stack outputs (including nested objects and arrays), not arbitrary resource options.
Keep the original resource type for field-name and value-type inference. Access
applications, Access service tokens, Workers and R2 tokens declare typed output
contracts; generic resource definitions retain JSON output typing.

Every deployment refreshes Worker bindings after provisioning. Changed audiences
and environment secrets trigger publication even when Worker source is unchanged;
unchanged resolved bindings reuse the existing publication. A read-only plan
compares declarations and cannot predict cloud-generated values or environment
secret rotation. Run deploy to reconcile these runtime changes.

Set environment variables through your shell/CI or an ignored `.env` file. Missing
or empty secrets fail closed. For local development, use local credentials under
the same variable names. `local` supplies an explicit non-production substitute
for cloud-only outputs; it is ignored during deployment. Renkin does not emulate
Access enforcement. Keep real credentials out of `local` literals.

Environment secret values are resolved only for Worker publication and local
runtime bindings. Renkin does not put them in resource definitions, build results,
plan/progress output or ordinary Worker state. Provider-generated secrets remain
in encrypted cloud state (or owner-only local state) as required for recovery.
References inherit the target's secret classification: for example,
`resourceOutput(serviceToken, "clientSecret")` uploads as a Worker secret, and
`output(resourceOutput(serviceToken, "clientSecret"))` stays redacted unless
`--reveal-secrets` is requested. An explicit `{ secret: false }` cannot downgrade
an output reference. Exporting `output(secret("ENV_NAME"))` deliberately stores a
secret stack output under those same state protections.

Framework bindings are server-only and `SiteEnvironment<typeof site>` infers
secret/reference bindings as `string`. Renkin never substitutes these values into
browser bundles or build manifests. Your build scripts still control any explicit
`process.env`, Vite `define`, or public `VITE_*` substitutions; use separate public
configuration for browser-visible values.

Cloudflare source-map upload is currently unsupported. Ordinary Worker preparation
disables source maps, and `WorkerBuildResult.auxiliaryFiles` maps are captured for
build reuse but never uploaded. This applies to framework auxiliary maps as well.

## Astro: use the normal build command

Declare the site and install Renkin's integration in ordinary Astro configuration:

```ts
// renkin.ts
import { defineStack } from "@carere/renkin";
import { astro } from "@carere/renkin/cloudflare";

export const site = astro("site", {
  root: import.meta.dirname,
  output: "static", // use "server" for SSR
  compatibilityDate: "2026-07-30",
});
export default defineStack({ name: "my-site", resources: [site] });
```

```ts
// astro.config.ts
import { defineConfig } from "astro/config";
import { renkin } from "@carere/renkin/astro";
import { site } from "./renkin.ts";

export default defineConfig({
  integrations: [renkin(site)],
});
```

```sh
bunx --bun --package @carere/renkin renkin dev
bunx --bun astro build
bunx --bun --package @carere/renkin renkin deploy --env preview --yes
```

No `build.ts` is needed. Astro builds the site; the integration configures its
official Cloudflare adapter and writes `.renkin/build-result.json` for Renkin's
Worker/asset deployment pipeline. Keep your normal Astro routing, integrations,
styles and output settings in `astro.config.ts`. Do not also configure another
adapter. The integration's build setup does not provision cloud resources.

Deployment can build automatically; `buildAstro(site)` remains available from
`@carere/renkin/astro` for programmatic builds. To make deployment call your CLI/Moon task,
wrap the original site with `withBuildCommand` and point it at the generated manifest:

```ts
const deployedSite = withBuildCommand(site, {
  cwd: import.meta.dirname,
  command: ["bun", "--bun", "astro", "build"],
  manifest: ".renkin/build-result.json",
});
```

Import `withBuildCommand` from `@carere/renkin` and put `deployedSite` in the deployment
stack. The Astro config must continue to import the original `site`.

SSR gets a protected session KV namespace by default. Supply native resources via
`bindings`, choose an existing session binding with `sessionKVBindingName`, or set
it to `false` to disable sessions. Static output creates no session namespace.
High-level D1/R2/KV resources are attached after production page generation; use
SSR routes for resource access. See [the static example](apps/example-static) and
[Astro compatibility details](docs/agents/astro-sites.md).

## TanStack Start with Solid

Declare a site with `tanstackStart` from `@carere/renkin/cloudflare`, then use the public
Vite plugin:

```ts
// resources.ts
import { kv, tanstackStart } from "@carere/renkin/cloudflare";
export const site = tanstackStart("app", {
  root: import.meta.dirname,
  rendering: "ssr", // or "spa"
  compatibilityDate: "2026-07-30",
  bindings: { DATA: kv("data") },
});
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { renkin } from "@carere/renkin/vite";
import { site } from "./resources.ts";
export default defineConfig({ plugins: [renkin(site)] });
```

Include `site` in your stack and run `renkin dev`. The [SPA](apps/example-spa) and
[SSR](apps/example-ssr) examples show routing, hydration and native bindings.
Renkin skips unchanged framework builds when captured inputs and artifacts still
match. Declare external inputs through `reuse.inputs`; missing build artifacts
cause a rebuild. [Build reuse](docs/agents/build-reuse.md) documents external commands
and cache boundaries.

For native server bindings, infer the environment from your site instead of
repeating resource types in a handwritten interface:

```ts
// src/types/cloudflare.d.ts
// Keep this file ambient: use type import expressions, not top-level imports.
declare module "cloudflare:workers" {
  const env: import("@carere/renkin/cloudflare").SiteEnvironment<typeof import("../../resources.ts").site>;
  export { env };
}
```

Server code still imports `env` from `cloudflare:workers`. These type-only imports
add no infrastructure code to the application bundle. `SiteEnvironment` supports
TanStack and Astro declarations, including enabled Astro session KV bindings.
It describes native handles, preserves queue/workflow payload and service types,
and types string configuration as `string`. Infer from the original declaration
before widening it to a general resource type. Never access server bindings in
browser code.

## APIs, testing and further details

The root package exposes Effect operations including `development`, `deploy`,
`planDeployment`, `removeEnvironment`, `listEnvironments` and `readOutputs`.
Use `Effect.scoped(development(stack))` to manage a local session's lifetime.
Public helpers in `@carere/renkin/testing` exercise real local Workers, bindings, events,
restart persistence and captured email. Local emulation does not prove cloud-only
features such as custom domains, Access policies or production R2 CORS.

The README is the primary usage guide; no documentation website is maintained.
The following guides cover resource-specific options and operational details:

- [Connected Workers and KV](docs/agents/connected-workers.md)
- [D1 and migrations](docs/agents/d1-migrations.md)
- [R2 and preview environments](docs/agents/r2-and-previews.md)
- [Queues, Workflows and email](docs/agents/background-jobs.md)
- [Durable Objects](docs/agents/durable-objects.md)
- [Custom domains, Access and assets](docs/agents/sites-and-access.md)
- [Astro](docs/agents/astro-sites.md) and [TanStack](docs/agents/tanstack-sites.md)
- [Package assembly and checks](docs/agents/packaging.md)

## Developing this repository

Install [Proto](https://moonrepo.dev/docs/proto/install), then run `proto install`
in the repository. `.prototools` selects `bun = "latest"`, `moon = "latest"` and
`node = "lts"`. CI uses `moonrepo/setup-toolchain` to install the same toolchain.
Moon inherits Bun and Node versions from this file. These aliases can advance
across major versions. Keep Proto's shims on your PATH and invoke `moon` directly;
other npm tools remain development dependencies invoked through Bun.
Cocogitto **6.5.0 or newer** is also required for local commit checks.

```sh
git clone git@github.com:carere/renkin.git
cd renkin
proto install
bun install --frozen-lockfile
bun lefthook install
moon sync
bun tsc --build
bun biome check .
bun knip
bun sort-package-json --check package.json apps/*/package.json packages/*/package.json
```

`prepare` enables Effect diagnostics in TypeScript. `bun lefthook install` installs
Git hooks; `moon sync` synchronizes workspace configuration. Hooks check staged files
and Conventional Commit messages without rewriting or staging additional changes.
Use `bun biome check --write .` for formatting and import organization, and
`bun sort-package-json package.json apps/*/package.json packages/*/package.json`
for manifest sorting.

## Checks

```sh
bun tsc --build                       # Strict TypeScript project references
bun biome check .                     # Biome formatting, lint and import checks
bun sort-package-json --check package.json apps/*/package.json packages/*/package.json
bun knip                              # Unused files and dependencies
moon run core:typecheck core:lint     # An individual workspace
moon run :test-unit                   # Unit tasks across all workspaces
moon run :test-integration            # Integration tasks across all workspaces
moon run core:test-unit               # One workspace suite
cog check --ignore-merge-commits       # Commit history, once commits exist
```

Foundation validation runs Biome, TypeScript, Knip and manifest sorting directly.
TypeScript checks the workspace-owned tool configurations. Populated behavioral
suites cover resources, runtime, frameworks, example apps and the full local graph;
credentialed Cloudflare suites run separately. Workspaces only define Moon test
tasks for populated suites; running an empty Vitest project still fails.
See [package assembly](docs/agents/packaging.md) for standalone artifact checks.

Each workspace owns one `vitest.config.ts` and its Moon test tasks. Its named
unit and integration projects discover local `tests/unit/**/*.test.ts` and
`tests/integration/**/*.test.ts`; the owner can change discovery, environments
and setup independently. Moon aggregates matching tasks with `:test-unit`,
`:test-integration`, or any future `:test-xxx` name. Add other suites only where
needed. Use `@effect/vitest` for Effect behavior and add browser tooling when real
application flows exist. Read [CODING_STANDARD.md](CODING_STANDARD.md) before
contributing.

The Checks workflow first runs a static job: types, formatting/lint, unused code,
manifest sorting, conventional commits and the PR title. The test job only starts
if that job passes. Unit tests run together using `moon run :test-unit` with
normal Moon and Vitest parallelism. Integration, preparation and Astro suites
remain separate serial steps, using `--concurrency 1` for Moon and
`--no-file-parallelism` for Vitest to keep browser and local Cloudflare processes
from competing for runner resources. For example:

```sh
moon run --concurrency 1 :test-integration -- --no-file-parallelism
```

Renkin's config also owns the `preparation`, `astro`, `release`, `cloud` and
`installed-cloud` projects. Ordinary runs only discover local suites. Select
`--mode release --project release` for installed-package checks, or
`--mode cloud --project cloud` for credentialed provider tests. The installed
cloud suite uses `--mode cloud --project installed-cloud` and requires its
explicit consumer and resource-scope configuration. Moon tasks supply these
selectors for their corresponding suites.

## Workspace tooling

The setup adapts Delimoov's Bun, Moon, strict TypeScript, Effect diagnostics,
Biome, Vitest, Knip, Lefthook and Cocogitto conventions. Only the required prepare
hook lives in root package scripts. Repository checks run directly; Moon tasks
belong to apps and packages, with shared defaults in `.moon/tasks/`. There is no
root Moon project. Moon uses local caching
and the shared Remoshu HTTP cache at `https://remoshu.carere.workers.dev`, with
Renkin artifacts isolated under `carere/renkin`. Cache integrity verification is enabled.
Repository checks run directly, outside Moon caching.
Configure application build inputs and external command ordering through the
[build reuse API](docs/agents/build-reuse.md); workspace Moon task definitions remain explicit.

Dependencies use caret (`^`) ranges. `bun.lock` records the exact resolved versions;
`bun install --frozen-lockfile` keeps CI reproducible. Run `bun update` to select
newer compatible versions, review the lockfile, and rerun checks. Caret ranges
normally permit minor and patch updates; for `0.x` releases they stop at the next
minor. Effect is currently a prerelease: update Effect and `@effect/vitest`
together and validate compatibility before broadening their ranges.

The published Effect peer uses the same caret range as development tooling.
Consuming workspaces declare their own dependencies. Runtime selection lives in
`.prototools` and CI rather than an exact `packageManager` pin; Moon's automatic
synchronization of that field is disabled.

GitHub Actions runs the same checks, verifies Conventional Commits and PR titles,
and checks for configuration drift. It needs no Cloudflare credentials. Review
[AGENTS.md](AGENTS.md) and the individual `.agents/skills/*/SKILL.md` files for
agent workflows. Apache 2.0 licensing, source provenance and external dependency notices are present
in LICENSE, NOTICE, SOURCE_PROVENANCE.md and THIRD_PARTY_NOTICES.md.

## Remote cache credentials

Set `MOON_REMOTE_CACHE_TOKEN` in the ignored root `.env` file; `.env.example`
contains the variable name only. Direct `moon` commands do not load `.env`:
export the variable in your shell before running Moon. Never commit the token.

CI reads the GitHub Actions secret `MOON_REMOTE_CACHE_TOKEN`; configure that secret
for `carere/renkin` to enable authenticated cache access. A local `.env` is not
uploaded to GitHub. Cacheable project tasks can reuse remote results; repository checks run directly.

## Versioning and changelog

[`cog.toml`](cog.toml) configures one repository-wide release version for the sole
published `@carere/renkin` package. Commits across private packages also affect that
version; private workspaces do not receive independent release tags. Releases
use `v`-prefixed tags and a root `CHANGELOG.md` with GitHub links.

```sh
cog check                          # Validate the complete Conventional Commit history
cog changelog                      # Preview release notes without writing files
cog bump --auto --dry-run           # Preview the next version from committed changes
```

Once a release is ready, run `cog bump --auto` on a clean `main` checkout. The
pre-bump hooks validate commits, update `packages/renkin/package.json` with
`bun pm --cwd packages/renkin version <version> --no-git-tag-version`, refresh
`bun.lock` without install scripts, and stage both files. Cocogitto then writes the changelog,
creates the version commit and adds its tag. Other package versions stay private
and unchanged. No push, publication or deployment is triggered by these hooks.

As in Zaidan, `build`, `chore`, `perf`, `refactor`, `revert` and `style` commits
trigger patch bumps, alongside the default `fix` rule. `feat` triggers minor
bumps, and breaking changes affect the next version. Handwritten `merge:` commits
are accepted and omitted from release notes. Before 1.0, automatic bumps stay
below 1.0; choose the first stable release explicitly. Dry runs do not execute
bump hooks.

Versioning does not publish a package. Build the standalone artifact with
`moon run renkin:pack` and inspect its identity using the commands in
[package assembly](docs/agents/packaging.md). Source-workspace packing remains
guarded; only the staged tarball is an intended distribution artifact. Use the
manual **Release** workflow to prepare a draft GitHub release and optionally
publish its validated tarball to npm under `latest`. For the first publish and OIDC
setup, follow [the release procedure](docs/releasing.md).

References: [Cocogitto configuration](https://docs.cocogitto.io/reference/config.html)
[automatic versioning and hooks](https://docs.cocogitto.io/guide/bump.html),
and [Bun package versioning](https://bun.com/docs/pm/cli/pm#version).
