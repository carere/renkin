# Asset-backed protected sites — 2026-09-21

Ticket #10 builds on the explicit reconciliation boundary from ticket #4 and the
Worker publication/dependency support from ticket #5. This record does not claim
completion of the remaining framework or release-packaging tickets.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Static assets, routing and domain lifecycle | Native runtime and public local tests; authenticated cloud HTML and updated SPA navigation; owned-domain replacement/recovery integration; cloud teardown. |
| Public external-build contract | `WorkerBuildResult` and `AssetRouting` imported from `renkin`; public protected-site local integration uses an already-built ES module and asset directory. |
| Observability destination lifecycle | SDK boundary tests plus real create, provider read, same-ID enabled/header update and deletion; Worker provider settings confirm trace destination, sampling and redaction. |
| Access apps, policies, tokens and fork settings | SDK serialization and fresh-observation integration; actual cloud reusable service-token policy, unsigned CORS preflight and eager-cookie settings. |
| Omitted Access settings preserved | Integration covers partial CORS and explicit false; cloud update changes allowed headers while retaining observed origins, credentials and eager-cookie setting. |
| Protected authorized site and cleanup | Cloud public API scenario, blocked unsigned/alternate-origin access, stable IDs on update, one-time secret recovery and successful teardown; token/origin isolation and certificate inventory recorded below. |
| Credential-free local and separate cloud tests | Local package suites and public protected-site declaration; dedicated cloud config; documented local Access, DNS/TLS and OAuth limitations. |

## Local evidence

Checks used Bun 1.4.2, Node 24.21.0, Effect 4.0.0-rc.115 and Distilled rc.12.
TypeScript project build and Biome passed. Knip passed after the local CLI tests
finished removing their temporary consumer fixtures; running Knip concurrently
with those tests can observe their transient files.

- SDK integration: 25 tests passed, including account-fenced asset upload JWTs,
  multipart content types and public provider request/response serialization.
  The three site-client tests also passed with Vitest executing under Bun.
  Bun's multipart parser drops a parsed File's MIME type, so the assertion checks
  the actual multipart wire Content-Type instead.
- Runtime integration: six tests passed. Native workerd assets cover static HTML,
  SPA navigation fallback, HTML extension routing, Worker-first API routing and
  reload. The external-build manifest test covers additional modules,
  `.assetsignore` including negation, and `_headers`/`_redirects` extraction.
- Public package integration: seven tests passed. The new external-build consumer
  uses only `renkin` and `renkin/cloudflare`, includes Access/domain/observability
  declarations without contacting those providers, and verifies native header rules,
  redirects, SPA routing, API routing and reload without provider credentials.
  This public protected-site local test also passed with Vitest executing under Bun.
- Focused Access/site/receipt/asset-authorization integration: seven tests passed.
  Fresh provider observations preserve omitted Access fields, merge supplied CORS
  fields, retain explicit false, and reject changed ownership. An owned custom
  domain moves to a replacement Worker and can recover after losing that update's
  response. A token whose one-time receipt is missing stops without creating or
  rotating a token.
- Private publication integration: two tests passed through the real SDK HTTP
  boundary. A previously public Worker origin is disabled before private source
  upload; rejecting that closure prevents the upload entirely.
- Coordinator plus receipt integration: ten tests passed, including actual
  SQLite Durable Object restart, encrypted response replay across lease changes,
  request-digest rejection, atomic matching checkpoint acknowledgement, and
  preservation of opaque encrypted snapshots. The state memory checkpoint also
  validates a 10 MiB local snapshot across restart; local emulation does not prove
  an arbitrary cloud size limit.

## Cloud evidence

The public cloud suite is separate from ordinary tests:

```sh
cd packages/renkin
bun --env-file=/secure/path/to/authorized.env vitest run \
  --config vitest.cloud.config.ts tests/cloud/root/protected-site.test.ts
```

It checks current authorization expiry, prefix, domain, zone and confirmed product
scope. The run beginning at 13:05:38 Europe/Paris passed in 205.66 seconds against
`renkin-test-site-9fddc5c3.renkin-test.carere.dev`, using its own temporary
coordinator. It exercised these behaviors through the public API:

1. Create an observability sink and destination, then deploy an external asset
   artifact with Access token, reusable policy, application and custom domain.
2. Lose the successful service-token creation response at the client boundary,
   rerun deployment, recover the same provider token ID from its encrypted receipt,
   and use its recovered secret successfully against Cloudflare Access.
3. Serve authenticated static HTML, reject an unauthenticated request, disable the
   alternate workers.dev origin, and answer an unsigned CORS preflight.
4. Update the asset and a supplied CORS field while preserving omitted origins,
   credentials and eager-cookie configuration. Read those settings back directly
   from Cloudflare, along with Worker trace destination, sampling and query-string
   redaction settings. Verify updated SPA navigation content over HTTPS.
5. Update observability destination enabled/header settings without replacing its
   provider ID, then remove the site resources, destination, sink and isolated
   state coordinator.

Initial attempts exposed real provider pagination constraints (observability
`perPage` maximum 50), TLS certificate propagation, and a probe issue: Node fetch
rewrites `Sec-Fetch-Mode: navigate` to `cors`. The SPA cloud probe uses Node HTTPS
so it sends the intended browser-navigation header. Failed runs are not counted
as successful validation. A new backend also returned an initial workers.dev 404;
bootstrap now waits for the authenticated read-only identity endpoint, retrying
only 404 within a bounded deadline. The final run beginning at 13:21:01 Europe/Paris passed in 212.36 seconds with
the private-origin pre-publication ordering fix included. It also rejected an
unrelated valid service token and an unapproved browser origin, verified CORS
methods/requested headers, and read back workers.dev/preview disablement. All
provider resources and the isolated coordinator were removed. Protected-host
probes retry only bounded TLS/DNS propagation failures, not HTTP authorization
failures; a disabled alternate origin may itself reject TLS, so its provider
settings are verified independently.

Cloudflare retains automatically generated certificates after domain removal.
The ordinary deployment token lacks certificate inventory permissions; the parent
validation process used an authorized short-lived zone SSL token to inspect the
exact hostname and revoked that token. It found no matching certificate pack at
that inspection. After the final run, the authorized parent validation process again obtained a
short-lived zone SSL-write token and read `certificate_packs?status=all` with
HTTP 200. No matching retained certificate was observed for the exact test
hostname; no certificate deletion was needed or attempted. The temporary token
was revoked with HTTP 200. This is an inventory observation, not a claim that a
certificate pack was deleted.

## Reference and implementation provenance

Behavioral references were inspected at Alchemy revision
`82b7fc24c03db868772a60bb2927054582d22f43` and Delimoov revision
`cb885863bb6b91901865700bb947c84742aae069`: Access application/policy/token
implementation and tests, deployed browser preflight/preview-isolation tests, and
Worker assets/observability use. No implementation source was copied. Distilled,
Miniflare, `ignore` and `mime` are external dependencies; no Alchemy dependency or
package alias was introduced. See [site usage and limitations](../sites-and-access.md).
