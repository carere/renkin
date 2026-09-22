# testing

Public reusable Worker fixtures use real workerd and close with an Effect scope. Tests stay with their owning packages; packages/renkin validates this helper through renkin/testing. This package has no separate behavioral suite yet.

See [Worker usage and validation](../../docs/agents/worker-first-slice.md) and
[architecture](../../docs/agents/architecture.md) for interfaces, ownership and limitations.
