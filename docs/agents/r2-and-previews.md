# R2 uploads and isolated previews

Declare `r2` and bind it in a `defineWorker` requirements map. The client exposes
Effect operations and the real `native` R2 bucket. Local objects live in
`.renkin/data/<stack>/<environment>`; logical renames preserve the recorded
physical namespace. Separate environments get separate namespaces and buckets.

```ts
import { r2, r2Token, worker } from "renkin/cloudflare";
import { defineStack } from "renkin";

export const Files = r2("Files", {
  cors: [{ allowed: {
    origins: ["https://app.example"],
    methods: ["GET", "PUT", "HEAD"],
    headers: ["content-type"],
  }, exposeHeaders: ["etag"] }],
});
export const Uploads = r2Token("Uploads", {
  buckets: [Files],
  permissions: "read-write", // or "read-only"
  expiresAt: "2026-09-22T21:59:59Z", // choose a stable, future expiry for your preview
});
export default defineStack({ name: "app", resources: [
  Files, Uploads, worker("Api", { entry: "./worker.ts", compatibilityDate: "2026-07-30" }),
] });
```

A token can reference only buckets owned by that environment, all in the same
jurisdiction. Its account policy grants object access to those exact physical
buckets. It does not grant account-wide R2 administration. Bucket scope, permission
or expiry changes require explicit token replacement. Use an explicit token
`identity` when replacing a bucket while keeping its logical ID; the token never
broadens an existing credential to the new physical bucket. A missing managed token or
a token whose one-time secret cannot be recovered is an error, never permission
to silently recreate or rotate credentials.

Deploy previews with stable names such as `environment: "pr-123"`. Token management
requires a separately supplied `cloudflare.tokenManagementApiToken`; the normal
`cloudflare.apiToken` still controls Workers, R2 provisioning and state discovery.
Neither management credential is written into a resource or Worker binding.
For CLI deploy/remove, pass `--token-management-token-env YOUR_TOKEN_VARIABLE`;
the argument is a variable name, never a credential value.

## Application signing

In Worker code, bind the same pure resource descriptors:

```ts
import { Effect } from "effect";
import { defineWorker } from "renkin/worker";
import { Files, Uploads } from "./resources.ts";

export default defineWorker({ Files, Uploads }, ({ Files, Uploads }) => ({
  fetch: (request) => Effect.promise(async () => {
    const credentials = Uploads.forRequest(request);
    // Your application signer uses credentials.endpoint, region, accessKeyId,
    // secretAccessKey and credentials.buckets.Files. Return a presigned URL,
    // never the credentials themselves. Join relative bucket/key paths with
    // new URL(encodedBucketAndKey, credentials.endpoint) to avoid doubled slashes.
    // Encode individual key segments, and reject dot segments before URL construction.
    const object = await Files.native.get("example.txt");
    return new Response(object ? await object.text() : null);
  }),
}));
```

Renkin supplies configuration, not an AWS signing client. The account token ID is
the S3 access key ID; SHA-256 of the one-time token value is its S3 secret key.
Cloud credentials enter the Worker as a `secret_text` binding. Token outputs are
redacted by default and encrypted in Cloudflare state. Creation responses are
persisted as encrypted, intent-bound receipts before acknowledgement, allowing
recovery after a lost response without issuing a second token.

## Opt-in local S3 endpoint

```ts
const session = yield* development(stack, {
  environment: "pr-123",
  r2S3: { accessKeyId: "local-only-key", secretAccessKey: "local-only-secret" },
});
```

Use development credentials, not cloud credentials. `Uploads.forRequest(request)`
returns these local values and maps logical bucket IDs to the endpoint's bucket
names. Its endpoint is resolved against the incoming Worker request. Alternatively,
`localS3Endpoint(session.workers.Api.url)` from `renkin/worker` returns the base
path-style endpoint. Append the encoded bucket/key and sign with your application
library. Only buckets bound natively or through that Worker's token descriptor are
available through its endpoint. Local token bindings do not simulate cloud token
expiry or per-token read-only policies; the explicitly configured development key
controls this narrow upload endpoint. Cloud validation covers real token scope.

The endpoint runs before application or asset fallback at
`/cdn-cgi/local/r2/s3/`. It supports presigned PUT, GET and HEAD and unsigned OPTIONS
against the same native Miniflare bucket objects. Ordinary application paths are
forwarded unchanged. A frontend proxy must preserve the URL origin and path used
for signing; Vite forwarding belongs to the application integration slice.

Supported behavior includes encoded object keys, HTTP and custom metadata, quoted
ETags, response header overrides, single byte ranges and empty objects. Multiple
ranges deliberately return the complete object, matching the pinned reference.
Invalid/unsatisfiable single ranges return 416. HEAD returns no body, including
errors. Local OPTIONS uses permissive CORS; it does not validate cloud CORS rules.

SigV4 requires the algorithm, credential scope, timestamp, expiry, signed headers
and signature exactly once. Expiry is 1–604800 seconds; requests strictly after
expiry or more than 15 minutes in the future are rejected. Signing must include
`host`; duplicate/missing signed headers, malformed dates, session tokens and
Authorization-header authentication are rejected. Signatures cover the encoded
path and canonical query, using `UNSIGNED-PAYLOAD`.

This is not a general S3 server: no list/delete API, multipart, ACL, versioning,
checksums, Content-MD5, server-side encryption settings, storage-class overrides,
session credentials, or aws-chunked streaming. Unsupported operations return 501.
Do not use the local endpoint as evidence for those cloud features.

## Explicit cleanup

Buckets and token resources are protected by default. Set `allowDelete: true` on
each disposable resource and deploy that declaration before calling
`removeEnvironment(stackName, { environment, yes: true, cloudflare })`.
A nonempty bucket additionally requires `forceDestroy: true`; `--force` is never
deletion authorization. The two permissions apply to replacement as well as
removal. A failed nonempty removal retains ownership and pending work. A corrected,
identity-preserving declaration may explicitly allow emptying on retry.

Cleanup follows recorded physical identities and ownership evidence. It does not
search for matching name prefixes. Other environments, externally referenced
Workers and unrelated resources are untouched. After successful cleanup, the
empty environment record disappears from reads and listings under the same lease.
Shared state infrastructure, encryption keys and reconciliation audit remain.
Unacknowledged token receipts, pending provider operations, resources, bindings or
outputs prevent record removal. A stale lease cannot resurrect the deleted record.

`retain: true` deliberately leaves the physical resource and forgets its ownership
when the environment is removed; it is not a backup or a later cleanup claim.
Local emptying removes objects through native bindings. Emulator database files may
remain unbound; Renkin does not recursively delete the shared persistence directory.

Cloudflare's REST object deletion cannot safely represent dot path segments such
as `folder/../object` through URL-normalizing transports. Renkin refuses those keys
and preserves bucket ownership. Remove the exact key through its native binding
or an appropriate S3 client, then retry cleanup. It never substitutes a normalized
neighboring key. Literal slashes, spaces, percent signs and Unicode are preserved.

Consumer workflows own pull-request naming, schedules and explicit disposable
resource policy. Renkin provides the isolated environments and exact lifecycle;
it does not install GitHub automation or infer which existing previews to delete.

## References and verification

The narrow local behavior was compared with Alchemy revision
`82b7fc24c03db868772a60bb2927054582d22f43` and Delimoov revision
`cb885863bb6b91901865700bb947c84742aae069`; implementation is independent and does
not vendor either project. Cloud token derivation and object scopes follow the
[Cloudflare R2 token documentation](https://developers.cloudflare.com/r2/api/tokens/).
Cloud CORS uses the [R2 CORS configuration API](https://developers.cloudflare.com/r2/buckets/cors/).

Credential-free coverage runs through real Miniflare R2 objects and actual SDK HTTP
serialization. Application signing in tests uses the independent `aws4fetch`
development dependency; plain R2/native usage has no signing dependency.
The separately gated `packages/renkin/tests/cloud/root/r2.test.ts` exercises real
Cloudflare resources and requires explicit time-bounded resource and token-management
authorization.
