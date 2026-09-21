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
bun add renkin "effect@^4.0.0-rc.115"
```

For an unpublished release candidate, replace `renkin` with the path to its staged
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
import { defineStack } from "renkin";
import { worker } from "renkin/cloudflare";

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
bunx --bun renkin dev
```

The development command starts the local application graph, watches source changes
and keeps local data between restarts. No Cloudflare credentials are needed.
Local email is captured rather than sent. Local state lives under `.renkin/`;
exclude that directory from Git because it can contain secrets.

Effect handlers can use `defineWorker` from `renkin/worker`:

```ts
import { Effect } from "effect";
import { defineWorker } from "renkin/worker";

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
bunx --bun renkin plan --env preview
bunx --bun renkin deploy --env preview --yes
bunx --bun renkin list --stack hello
bunx --bun renkin outputs --stack hello --env preview
bunx --bun renkin remove --stack hello --env preview --yes
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
[explicit reconciliation](docs/worker-first-slice.md#reconcile-an-ambiguous-provider-operation)
is required after establishing its outcome. Resource recovery is not SQL rollback.

## Bind resources to application code

Declare resources once and use them in the Worker implementation. Renkin derives
binding requirements and deployment dependencies from that use:

```ts
// worker.ts
import { Effect } from "effect";
import { d1 } from "renkin/cloudflare";
import { defineWorker } from "renkin/worker";

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

## Astro: use the normal build command

Declare the site and install Renkin's integration in ordinary Astro configuration:

```ts
// renkin.ts
import { defineStack } from "renkin";
import { astro } from "renkin/cloudflare";

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
import { renkin } from "renkin/astro";
import { site } from "./renkin.ts";

export default defineConfig({
  integrations: [renkin(site)],
});
```

```sh
bunx --bun renkin dev
bunx --bun astro build
bunx --bun renkin deploy --env preview --yes
```

No `build.ts` is needed. Astro builds the site; the integration configures its
official Cloudflare adapter and writes `.renkin/build-result.json` for Renkin's
Worker/asset deployment pipeline. Keep your normal Astro routing, integrations,
styles and output settings in `astro.config.ts`. Do not also configure another
adapter. The integration's build setup does not provision cloud resources.

Deployment can build automatically; `buildAstro(site)` remains available from
`renkin/astro` for programmatic builds. To make deployment call your CLI/Moon task,
wrap the original site with `withBuildCommand` and point it at the generated manifest:

```ts
const deployedSite = withBuildCommand(site, {
  cwd: import.meta.dirname,
  command: ["bun", "--bun", "astro", "build"],
  manifest: ".renkin/build-result.json",
});
```

Import `withBuildCommand` from `renkin` and put `deployedSite` in the deployment
stack. The Astro config must continue to import the original `site`.

SSR gets a protected session KV namespace by default. Supply native resources via
`bindings`, choose an existing session binding with `sessionKVBindingName`, or set
it to `false` to disable sessions. Static output creates no session namespace.
High-level D1/R2/KV resources are attached after production page generation; use
SSR routes for resource access. See [the static example](apps/example-static) and
[Astro compatibility details](docs/astro-sites.md).

## TanStack Start with Solid

Declare a site with `tanstackStart` from `renkin/cloudflare`, then use the public
Vite plugin:

```ts
// resources.ts
import { kv, tanstackStart } from "renkin/cloudflare";
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
import { renkin } from "renkin/vite";
import { site } from "./resources.ts";
export default defineConfig({ plugins: [renkin(site)] });
```

Include `site` in your stack and run `renkin dev`. The [SPA](apps/example-spa) and
[SSR](apps/example-ssr) examples show routing, hydration and native bindings.
Renkin skips unchanged framework builds when captured inputs and artifacts still
match. Declare external inputs through `reuse.inputs`; missing build artifacts
cause a rebuild. [Build reuse](docs/build-reuse.md) documents external commands
and cache boundaries.

## APIs, testing and further details

The root package exposes Effect operations including `development`, `deploy`,
`planDeployment`, `removeEnvironment`, `listEnvironments` and `readOutputs`.
Use `Effect.scoped(development(stack))` to manage a local session's lifetime.
Public helpers in `renkin/testing` exercise real local Workers, bindings, events,
restart persistence and captured email. Local emulation does not prove cloud-only
features such as custom domains, Access policies or production R2 CORS.

The README is the primary usage guide; no documentation website is maintained.
The following guides cover resource-specific options and operational details:

- [Connected Workers and KV](docs/connected-workers.md)
- [D1 and migrations](docs/d1-migrations.md)
- [R2 and preview environments](docs/r2-and-previews.md)
- [Queues, Workflows and email](docs/background-jobs.md)
- [Durable Objects](docs/durable-objects.md)
- [Custom domains, Access and assets](docs/sites-and-access.md)
- [Astro](docs/astro-sites.md) and [TanStack](docs/tanstack-sites.md)
- [Release validation and compatibility limits](docs/release-validation.md)

## Developing this repository

Use the latest stable Bun, the latest Node.js LTS, and Cocogitto **6.5.0 or newer**.
`.prototools` selects `bun = "latest"` and `node = "lts"`; Moon inherits both.
CI uses the same aliases and checks for the newest LTS release. Run `proto install`
to refresh locally managed runtimes. Runtime aliases can advance across majors.
Moon and npm tools are development dependencies; invoke them with `bun`.

```sh
git clone git@github.com:carere/renkin.git
cd renkin
bun install --frozen-lockfile
bun lefthook install
bun moon sync
bun tsc --build
bun biome check .
bun knip
bun sort-package-json --check package.json apps/*/package.json packages/*/package.json
```

`prepare` enables Effect diagnostics in TypeScript. `bun lefthook install` installs
Git hooks; `bun moon sync` synchronizes workspace configuration. Hooks check staged files
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
bun moon run core:typecheck core:lint # An individual workspace
bun moon run :test-unit               # Unit tasks across all workspaces
bun moon run :test-integration        # Integration tasks across all workspaces
bun moon run core:test-unit           # One workspace suite
cog check --ignore-merge-commits       # Commit history, once commits exist
```

Foundation validation runs Biome, TypeScript, Knip and manifest sorting directly.
TypeScript checks the workspace-owned tool configurations. Populated behavioral
suites cover resources, runtime, frameworks, example apps and the full local graph;
credentialed Cloudflare suites run separately. Empty test projects remain strict.
Standalone artifact validation passed on Linux and macOS, and installed Cloudflare
acceptance is complete across the documented release candidates. Source CI passed
237 behavioral tests before the Astro CLI integration; see
[release validation](docs/release-validation.md) for exact provenance and limits.

Each workspace owns its `vitest.config.ts` and its Moon test tasks. Its initial
unit and integration projects discover local `tests/unit/**/*.test.ts` and
`tests/integration/**/*.test.ts`; the owner can change discovery, environments
and setup independently. Moon aggregates matching tasks with `:test-unit`,
`:test-integration`, or any future `:test-xxx` name. Add other suites only where
needed. Use `@effect/vitest` for Effect behavior and add browser tooling when real
application flows exist. Read [CODING_STANDARD.md](CODING_STANDARD.md) before
contributing.

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
[build reuse API](docs/build-reuse.md); workspace Moon task definitions remain explicit.

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
contains the variable name only. The documented `bun moon` and `bun run` commands
load `.env` automatically. When invoking `moon` directly, export the variable in
your shell first. Never commit the token.

CI reads the GitHub Actions secret `MOON_REMOTE_CACHE_TOKEN`; configure that secret
for `carere/renkin` to enable authenticated cache access. A local `.env` is not
uploaded to GitHub. Cacheable project tasks can reuse remote results; repository checks run directly.

## Versioning and changelog

[`cog.toml`](cog.toml) configures one repository-wide release version for the sole
published `renkin` package. Commits across private packages also affect that
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
`bun moon run renkin:pack` and inspect its identity and the completed checks in
[release validation](docs/release-validation.md). Source-workspace packing remains
guarded; only the staged tarball is an intended distribution artifact. Registry
publication requires separate authorization and is not part of validation.

References: [Cocogitto configuration](https://docs.cocogitto.io/reference/config.html)
[automatic versioning and hooks](https://docs.cocogitto.io/guide/bump.html),
and [Bun package versioning](https://bun.com/docs/pm/cli/pm#version).
