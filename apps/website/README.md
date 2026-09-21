# Astro SSR website

A runnable server-rendered website through the public Renkin factory. It exercises
dynamic query rendering, native `CONTENT` KV, protected automatic `SESSION` KV,
cookie sessions and a page prerendered in workerd. The prerendered page explicitly
shows that high-level resource bindings are unavailable during generation.

From the workspace root:

```sh
bun moon run website:dev
bun moon run website:build
bun moon run website:test-integration
```

Build writes `dist/` and `.renkin/build-result.json`. The integration test serves
the built SSR modules in the real local Worker graph and checks native KV and
session behavior. No credentials are required. The example's namespaces are
protected by default; changing or removing the site does not silently delete data.
See [Astro usage](../../docs/astro-sites.md) for session variants and deployment.
