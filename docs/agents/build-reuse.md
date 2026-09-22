# Build reuse

Framework builds return a captured `WorkerBuildResult`. Its entry, modules,
auxiliary files (such as source maps), and effective assets belong to a private
local snapshot. Later compilation into the same `dist` directory cannot change
an artifact already selected for deployment. Auxiliary files are not uploaded as
Worker modules.

TanStack and Astro declarations accept `reuse`. The default fingerprint includes
application files, ancestor package manifests/lockfiles/TypeScript configuration,
transitive `workspace:` dependency sources, adapter options and explicit build
values. It does not consult Git's ignore list: an ignored `public/deployment.json`
is still an input. Build output/cache directories are excluded. For imports
outside those roots, declare additional inputs:

```ts
const site = tanstackStart("console", {
  root: import.meta.dirname,
  rendering: "spa",
  compatibilityDate: "2026-07-30",
  buildEnvironment: { VITE_STAGE: stage },
  reuse: { inputs: ["../../shared/config"] },
});
```

Automatically discovered dependency packages exclude their `tests` and `test`
directories. The application root and explicit `reuse.inputs` do not have this
exclusion. Arbitrary imports outside known roots are not automatically discovered.

A reusable result requires both the original compiler outputs and the captured
snapshot to match the previous complete inventory. Removing a chunk, effective
asset, routing file or source map triggers compilation. Cache hits still run
normal infrastructure planning, observation and reconciliation. Keep deployment
settings such as crons outside frontend source/configuration when those settings
do not affect the build.

Use `reuse: false` to compile every time. Custom callback/configuration objects
that cannot be represented as JSON disable reuse unless the declaration supplies
an explicit `reuse.key` plus `reuse.inputs` or `reuse.values` identifying their
captured inputs. Renkin does not infer callback identity from function text.
Update that key when external behavior changes.

`reuse.exclude` adds Gitignore-style exclusions relative to each input root.
Use it for custom generated directories; do not exclude source or build-time
configuration. `reuse.outputRoot` declares the directory owning all output files
and defaults to the application root. Explicit Astro `config.outDir` uses its
parent as the default output owner. This owner must not itself be deleted by the
compiler. Builds targeting the same owner serialize; unrelated processes fail
before writing if that owner is busy. The lock records its process ID. After an
interrupted process, inspect that process before removing its stale
`.renkin/build/output.lock`; live locks are never taken over by a timeout.

## External commands and Moon

Keep the framework site and its bindings declared once in `resources.ts`. The
build script imports that original site; the deployment entry can wrap it:

```ts
// build.ts
import { writeFile } from "node:fs/promises";
import { buildTanStack } from "renkin/vite";
import { site } from "./resources.ts";
await writeFile(".renkin/build-result.json", JSON.stringify(await buildTanStack(site)));

// renkin.ts
import { defineStack, withBuildCommand } from "renkin";
import { site } from "./resources.ts";
export default defineStack({
  name: "application",
  resources: [withBuildCommand(site, {
    cwd: import.meta.dirname,
    command: ["moon", "run", "console:build", "--force", "--cache", "off"],
    manifest: ".renkin/build-result.json",
  })],
});
```

The Moon task runs `bun --no-env-file build.ts`. Renkin validates its own local
reuse before invoking Moon; the child public builder also validates reuse. The
forced Moon invocation avoids restoring an incomplete or checkout-specific
manifest from a separate task cache. This does not add a remote artifact cache.
For Astro, configure `renkin(site)` in `astro.config.ts` and use
`["bun", "--bun", "astro", "build"]`: the integration writes the manifest automatically.
`buildAstro(site)` remains available for programmatic builds. A direct command
such as `["bun", "--no-env-file", "build.ts"]` works without Moon.

`withBuildCommand` preserves the site's native binding metadata, dependencies and
local development recipe. It consumes the fully prepared public build result
without adding another framework wrapper. The script must import the original
site, not the declaration wrapping the command. A verified child lease permits
this nesting without allowing sibling compilers to write the same output root.

For an ordinary Worker, `buildCommand(options)` is a production builder accepted
by `worker({ builder: ... })`. Commands use argv rather than a shell, receive only
standard process paths plus explicit `environment`, and write their result to the
manifest file. Relative result paths resolve against `cwd`. Compiler stdout and
stderr are diagnostics on stderr, preserving the CLI's JSON stdout channel.
Missing or changed command manifests invalidate the command receipt as well as
missing or changed artifact files.

The maintained public tests run real Solid SPA/SSR and Astro static/SSR compilers,
check separate binding wrappers with one raw compilation, change shared source,
lock/configuration/public files and stage values, and remove emitted assets and
routing controls. Filesystem tests cover failed builds, concurrent stages,
corrupted captures, missing source maps and contention with another process. The
public external-command test executes Moon → Bun → `buildAstro` and restores a
deleted manifest without recursive lock contention.
