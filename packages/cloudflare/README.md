# cloudflare

The initial Cloudflare resource adapter deploys stateless Workers through the released SDK. Account-level cloud state uses a bootstrapped coordinator Worker and SQLite Durable Object, authenticated encryption, renewable environment leases and fenced mutation dispatch. Bootstrap and coordinator integration tests run against local HTTP fixtures and real workerd.

See [Worker usage and validation](../../docs/worker-first-slice.md) and
[architecture](../../docs/architecture.md) for interfaces, ownership and limitations.
