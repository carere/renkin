# Installed cloud acceptance harness

`prepareInstalledCloud(checkoutRoot, consumerDirectory)` copies the maintained public cloud
acceptance into an already installed, isolated consumer. It does not install dependencies,
load environment files, contact Cloudflare, or run tests. The consumer must contain the
standalone `renkin` artifact and the four copied example applications supplied by the release
consumer setup. Package and application realpaths must remain inside that consumer.

The copy preserves the source test assertions and cleanup paths. A fixed inventory fails if a
maintained suite is added or removed without updating this mapping. The generated
`release-cloud-manifest.json` records source and adapted hashes. Fixtures reject symlinks and
exclude environment files, dependency directories, generated output and mutable caches.

| Maintained suite | Installed adaptation |
| --- | --- |
| worker | Resolve CLI from installed package manifest, then invoke its installed bin |
| connected-worker | Unchanged; cross-stack ownership and references |
| d1 | Unchanged; native database operations and protection |
| background | Unchanged; queues, Workflow, cron and authorized email |
| durable-object | Unchanged; native identity and storage |
| durable-object-recovery | Unchanged; interrupted recovery |
| durable-object-retirement | Unchanged; exact namespace retirement protection |
| r2 | Replace private JSON type import with its structural type; scoped token assertions retained |
| protected-site | Unchanged; Access, domains, alternate origin and isolated coordinator bootstrap |
| astro | Unchanged; copied example roots resolve inside consumer |
| tanstack | Unchanged; copied example roots resolve inside consumer |
| full-graph | Infer state/resource types from public functions; observe exact cron through an independent read-only provider request instead of importing a private SDK client |

The full graph retains its native service flow, email, signed S3, compiler-count, cron-only
update and exact cleanup assertions. The fixed Request normalization in its bounded fetch
helper is copied unchanged. No `@renkin/*` imports or source CLI fallback remain in the
adapted suite/support files. The consumer has no Vitest aliases back to the checkout.

## Preparation checks

From `packages/renkin`, run:

```sh
bun --no-env-file node_modules/vitest/vitest.mjs run \
  --config vitest.release-cloud.config.ts --project preparation
```

The preparation test uses a synthetic installed manifest solely to test copying and boundary
validation. It is not evidence of an actual artifact install. Separately, this harness was
prepared against the release owner's actual tarball consumer. With OS outbound networking
denied, Vitest imported all 12 suites using `--testNamePattern '^$'`: 12 files and 13 tests
were skipped, exit zero. That proves runtime imports resolve from the installation; it is
**not cloud acceptance**. The installed CLI helper also resolved its bin inside the package.

## Later authorized execution

`runInstalledCloud(consumerDirectory, explicitScopeEnvironment, optionalSuiteNames)` runs
only the prepared consumer, with an allowlist of explicit account, zone, resource-prefix,
domain, expiry, budget, token-management and email scope fields. It uses Bun `--no-env-file`,
a separate configuration home, sequential test files and fail-fast execution. It does not
retry a failed suite. Existing per-test time bounds and cleanup blocks remain intact.

The caller owns authorization, remaining shared budget and email allowance, exclusive cloud
mutation ownership, the allocation ledger and post-run cleanup audit. Scope validation is not
a spending meter or permission grant. A failed run must be inspected for exact owned resources
before retrying; neither this runner nor its manifest establishes successful cleanup.

The optional Vitest wrapper requires `RENKIN_INSTALLED_CLOUD_CONSUMER` and the explicit scope
fields exported in `scopeKeys`. `RENKIN_INSTALLED_CLOUD_SUITES` may select comma-separated
catalog names. Invoke `--project installed-cloud` explicitly only after approval. The default
selection runs all 12 suites, which can send emails in background and full-graph acceptance.
Do not run the whole release-cloud configuration as a preparation check.

## Bootstrap and authorization boundary

The protected-site public suite creates a uniquely named isolated backend through public
`deploy`, uses it for its resources and removes it in cleanup. When executed from this consumer,
that exercises the installed dynamic coordinator/authentication-probe assets. The ordinary
Worker suite also invokes the installed CLI for public authentication behavior.

The private adapter suite
`packages/cloudflare/tests/cloud/root/services/state/state-authorization.test.ts` is explicitly
excluded. Its direct internal protocol/authorization assertions are not replaced by the 12
public suites, and no installed execution of those private invariants is claimed. The release
owner must map any additional public bootstrap/authentication acceptance separately.

No provider tests or cloud mutations were executed while preparing this harness.
