# Astro static example

A runnable Astro site through the public Renkin factory. `renkin.ts` declares the
site; `astro.config.ts` uses the `renkin(site)` integration from `renkin/astro`.
The build task runs the normal `astro build` CLI; there is no custom build script. Page generation
runs in workerd and the generated assets deploy through the shared Worker pipeline.
Static output creates no session KV namespace.

From the workspace root:

```sh
bun moon run example-static:dev
bun moon run example-static:build
bun moon run example-static:test-integration
```

Run `bun --bun astro build` directly in this directory, or use the Moon build task.
The integration writes `dist/` and `.renkin/build-result.json`. The integration test serves
that public artifact in the real local Worker graph, including routes and headers.
See [Astro usage](../../docs/astro-sites.md) for cloud deployment and configuration.
