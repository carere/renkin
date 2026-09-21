# Preserve behavior while allowing redesigned internals

Renkin replaces Delimoov's Alchemy fork with behavior compatibility across the
consumer's required capabilities, TanStack Start Solid SPA/SSR and Astro static/SSR,
including the fork's added behavior. Consumer declarations and imports may change,
but the public API must stay simple: simplifying Renkin must not shift complexity
to its consumers. We permit redesigned internals from the start with explicit
compatibility checks, replacing the previous preserve-first/simplify-later
sequence so that unnecessary upstream machinery need not be carried forward.

The exact public API remains open. The later
[fresh-start decision](0002-start-with-fresh-infrastructure.md) excludes migration
of existing Alchemy deployments from the first release.
