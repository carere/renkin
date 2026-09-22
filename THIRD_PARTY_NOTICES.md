# Third-party dependencies

Renkin is licensed under Apache-2.0. Its release consists of Renkin's emitted source
and declarations. The packages below are external dependencies, not copied source
inside Renkin's JavaScript bundle. Their distributions retain their own licenses
and notices; this inventory does not relicense them. Effect remains a peer supplied
by the consumer. Exact installed versions are recorded by each consumer's lockfile.

This inventory records the repository lockfile reviewed on 2026-09-21. Dependency
ranges remain in the release manifest; the isolated-consumer validation record
must state its actual resolutions.

| Package | Reviewed version | Declared license |
| --- | --- | --- |
| effect | 4.0.0-rc.115 | MIT |
| @distilled.cloud/cloudflare | 1.0.0-rc.12 | Apache-2.0 |
| @cloudflare/workers-types | 5.20260921.1 | MIT OR Apache-2.0 |
| esbuild | 0.28.2 | MIT |
| miniflare | 4.20260730.0 | MIT |
| mime | 4.1.0 | MIT |
| ignore | 7.0.9 | MIT |
| @astrojs/cloudflare | 14.3.2 | MIT |
| @cloudflare/vite-plugin | 1.56.0 | MIT |
| @tanstack/solid-start | 1.168.54 | MIT |
| astro | 7.3.3 | MIT |
| solid-js | 1.9.15 | MIT |
| srvx | 0.11.22 | MIT |
| vite | 8.3.0 | MIT |
| vite-plugin-solid | 2.11.14 | MIT |

Licenses were read from each installed package manifest. Top-level license texts
were also present for Effect, Distilled, esbuild, mime, ignore, Astro, its Cloudflare
adapter, TanStack Solid Start, Solid, srvx and Vite. Packages can carry additional
attribution in their own distributions; consult those distributions for the complete
notice text and transitive dependency details. Renkin's build tooling (including
Babel parser, TypeScript and test/browser tools) is not a runtime dependency solely
because it is used to assemble or validate this artifact.

For source references and generated-file provenance, see SOURCE_PROVENANCE.md.
