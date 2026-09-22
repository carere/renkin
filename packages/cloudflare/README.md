# cloudflare

The initial Cloudflare resource adapter deploys stateless Workers through the released SDK. Account-level cloud state uses a bootstrapped coordinator Worker and SQLite Durable Object, authenticated encryption, renewable environment leases and fenced mutation dispatch. Bootstrap and coordinator integration tests run against local HTTP fixtures and real workerd.

See [Worker usage and validation](../../docs/agents/worker-first-slice.md) and
[architecture](../../docs/agents/architecture.md) for interfaces, ownership and limitations.

The opt-in state pressure regression creates one disposable coordinator containing
only synthetic data, writes and reads twenty 20 MiB encrypted checkpoints, then
removes its Worker and Durable Object namespace. It requires the normal explicit
Cloudflare test scope plus `RENKIN_CLOUDFLARE_STATE_PRESSURE_TESTS=true`:

```sh
bun --bun vitest run --mode cloud --project cloud tests/cloud/root/services/state/state-pressure.test.ts
```

Run it from this package with the authorized environment already loaded. Local
workerd tests cannot substitute for this provider memory/admission regression.
The state wire format and atomic checkpoint transaction remain unchanged; native
Base64 conversion avoids temporary binary strings on Workers and Bun, with a
standard Base64 fallback for host tooling that lacks those native APIs.
