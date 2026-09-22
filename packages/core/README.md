# core

The infrastructure engine owns stack definitions, dependency ordering, complete-plan protection checks, checkpointed resource operations and state repositories. File state uses owner-only JSON records and SQLite process locks. Unit tests cover domain policy; integration tests exercise real file state, killed processes and interrupted operations.

See [Worker usage and validation](../../docs/agents/worker-first-slice.md) and
[architecture](../../docs/agents/architecture.md) for interfaces, ownership and limitations.
