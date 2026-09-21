# Astro static and SSR — 2026-09-21

Ticket #12 uses the shared framework builder/development lifecycle from #11 and
the resource/state/runtime boundaries accepted in #4–#10. Release artifact
packaging and shared build caching remain separate tickets.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Current verified framework versions | Astro 7.3.3, official Cloudflare adapter 14.3.2, Vite 8.3.0 and Cloudflare Vite plugin 1.56.0; actual build and native workerd tests. |
| Runnable static example | `apps/example-static`, public factory/standalone build, generated workerd marker, static routes and headers, real Chromium navigation. |
| Runnable SSR example | `apps/website`, public factory/standalone build, dynamic query rendering, native CONTENT KV, cookie sessions and prerendered page. |
| Automatic/existing/disabled session KV | Public local development and built-artifact tests; automatic namespace protected by default, persisted across restart, removal blocked when sessions are disabled; existing VISITS and disabled-session runtime assertions. |
| Production page generation | Actual official workerd prerender, native resource binding unavailable during generation; explicit Node fallback separately verified. |
| Configuration and build output | Base paths/trailing slash, alternate config file, Vite source-map hooks, maps retained as build output, assets/headers and separate SSR modules. |
| Native local behavior | Request-scoped graph bindings, native persistent KV, source reload, browser sessions, no Cloudflare credentials. |
| Cloud behavior and cleanup | Dedicated maintained cloud scenario exists; actual publication validation is still pending the shared failure investigation below. |

## Local evidence

Bun 1.4.2, Effect 4.0.0-rc.115 and Distilled Cloudflare rc.12 were used. The
application graph remains on Miniflare 4.20260730.0. The official adapter's
Miniflare 5.20260918.0-alpha is used only during production build/prerender;
no second native storage graph is started for development.

- Public Renkin integration: 31 tests passed with Astro and TanStack factories
  both exported. Ordinary Workers still bundle without traversing host-only
  framework tools.
- Websites integration: five tests passed at the Astro checkpoint, including
  actual workerd static/SSR output, base-path Node fallback, source-map hooks,
  and concurrent static/SSR requests under symlinked project roots. The shared
  native binding bridge also passed. Later combined framework tests add R2-origin
  coverage owned by #11.
- Static example: one integration passed, including a real Chromium route click,
  native asset headers and missing-page response.
- SSR example: one integration passed, including native KV read/write, dynamic
  route rendering, workerd generation without CONTENT, and Chromium cookie
  sessions incrementing from one to two.
- Manual agent-browser inspection also confirmed static navigation, dynamic SSR
  query output and native session cookies. Browser and local graph were closed.
- TypeScript project build, Biome, Knip, manifest sorting, Moon synchronization
  and whitespace checks passed. Temporary test consumer files must finish cleanup
  before running static analysis; concurrent scans can observe those transient files.

The combined build probe exposed two verified adapter constraints. Canonical
project paths avoid `/tmp` versus `/private/tmp` compiler metadata mismatches.
Overlapping official adapter builds in one process can close another prerender
runtime dispatcher; Astro's adapter boundary queues builds sequentially. The
central runtime and generic stack preparation concurrency remain unchanged.
An alternate config regression also verified Astro's root-relative config path
semantics. Session settings at the resource boundary override file-level drivers
so provisioned KV and runtime behavior agree.

## Cloud investigation and cleanup

All scopes used the explicitly authorized test account and prefix, the canonical
`renkin-test-state-v2` backend, and an exact unique hostname. No backend upgrade
was performed by this ticket.

- `renkin-test-astro-82bf86d8/preview` failed before provider creation during the
  combined build; its empty environment was removed.
- `renkin-test-astro-c559686b/preview`, `renkin-test-astro-edffc9b2/preview` and
  `renkin-test-astro-54773f62/preview` passed build and provisioned two Workers,
  two KV namespaces and their exact custom domain, then failed at publication.
  Finally blocks removed the owned domain, Workers, KV namespaces and empty
  environment in every case. These are failed acceptance runs, not cloud success.
- Exact-host certificate inventories for c559686b and edffc9b2 found zero packs;
  the temporary read-only zone token used for that inventory was revoked.
- A response-only diagnostic for 54773f62 observed no failing mutation gateway
  HTTP status. Its synthetic check proved that it preserved request/response
  bodies and emitted only numeric codes and fixed error categories.
- The actual SSR build artifact passed local asset session/upload and SDK
  multi-module publication through an inert capture gateway: 22 script parts,
  nested chunks preserved, approximately 655 KB multipart payload. This proves
  local serialization, not real provider acceptance.

## Provenance and boundary

The comparison baseline was Alchemy revision
`82b7fc24c03db868772a60bb2927054582d22f43` and Delimoov revision
`cb885863bb6b91901865700bb947c84742aae069`. Renkin imports neither Alchemy nor
copied Alchemy source. The adapter and compiler are independent dependencies;
the native KV development session driver is original TypeScript. Generated
JavaScript wrappers and driver entries are documented tooling output.
