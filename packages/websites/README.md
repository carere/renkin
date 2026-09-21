# websites

Owns framework recipes and build/development adapters. The Astro factory is public
through `renkin/cloudflare`, with standalone builds through `renkin/astro`.
See [Astro usage](../../docs/astro-sites.md) and the
[architecture](../../docs/architecture.md) for package ownership.

Astro uses the official adapter for production build and workerd page generation.
Its native development server receives request-scoped bindings from the shared
local Worker graph through the platform bridge. The common builder lifecycle
returns ordinary Worker build artifacts and connects development sessions only
after that graph is ready. The central runtime stays on Miniflare 4; the official
adapter's own build-time Miniflare 5 is isolated from local resource persistence.

Generated `.mjs` files are tooling output: static asset forwarding, framework
entry wrappers, and the development session-driver entry must be loadable by
Vite/workerd. Their generators remain TypeScript; do not manually edit generated
files. The session-driver implementation is original TypeScript, not copied from
Unstorage or Alchemy. The verified external package versions are recorded in the
lockfile and Astro validation documentation.

Run `bun moon run websites:test-integration` for actual workerd build/asset checks
and the native platform bridge test. The normal suite requires no cloud credentials.
