# Cloudflare SDK boundary

This private package uses external Distilled Cloudflare `1.0.0-rc.12` with Effect
`4.0.0-rc.115`. Import the client through
`@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client`.

`createCloudflareClient` accepts an explicit account ID and API token. It never
loads saved profiles, browser credentials, environment variables or global keys.
Its methods return Effects and retain Distilled's typed errors. In particular,
`WorkerNotFound` is distinct from `Unauthorized`, `InvalidRoute`, and `BadRequest`.
Reads retry throttling at most twice, with a 100 ms delay. Mutations do not retry
automatically because a failed response may follow an applied provider mutation.

Worker writes require a coordinator gateway and fencing token. Multipart requests
are serialized as base64, including their content type, and API authorization is
removed before passing them to the gateway. Gateway paths start with
`/accounts/{accountId}/`; the gateway supplies Cloudflare's API base URL and
validates ownership at dispatch. `createBootstrapClient` is the explicit direct
transport exception for installing the account coordinator before an environment
lease can exist. It must not be used for normal resource deployment.

Errors are not logged here. Callers should render safe summaries because provider
messages and transport causes may contain request information.

Integration tests exercise real Distilled serialization and error classification
against a loopback HTTP server and the gateway boundary. They need no Cloudflare
credentials. Run `bun moon run cloudflare-sdk:test-integration`. No unit suite is
defined yet; an empty unit run is not validation.
