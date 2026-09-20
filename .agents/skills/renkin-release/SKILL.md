---
name: renkin-release
description: Use when extracting upstream code, changing Renkin packaging, or preparing a release artifact.
---

# Extraction and release

Read `docs/architecture.md` first; it owns package boundaries and open decisions.

## Extracting source

1. Identify the smallest capability required by the task and its upstream revision.
2. Inspect its license, transitive source dependencies and required notices. Record
   origin, revision, files and modifications with the extracted code.
3. Preserve observable behavior and validate it before simplifying. Keep reference
   repositories unchanged and avoid introducing prohibited Alchemy dependencies.
4. If work depends on the unresolved Distilled sourcing choice, present concrete
   alternatives and obtain that decision before extraction or dependency adoption.
   Work independent of that choice can continue.

## Preparing a release

1. Verify only `packages/renkin` is publishable and Effect remains a compatible peer.
2. Build the public API, CLI and declared subpaths with all necessary internal
   JavaScript and declarations. Resolve private workspace imports in both outputs.
3. Pack and inspect the actual tarball, then install it into a fresh consumer
   outside workspace resolution. Test imports, types, CLI and integrations there.
4. Remove the scaffold publish guard only when the real build and consumer checks
   replace it. Report artifact contents, checks and compatibility limits before
   any separately authorized publication.
