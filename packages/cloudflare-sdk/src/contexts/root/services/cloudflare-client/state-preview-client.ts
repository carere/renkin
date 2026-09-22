import * as Credentials from "@distilled.cloud/cloudflare/Credentials";
import * as Retry from "@distilled.cloud/cloudflare/Retry";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import { Data, Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { CloudflareConfig } from "./cloudflare-client.ts";

export class StatePreviewError extends Data.TaggedError("StatePreviewError")<{
  readonly message: string;
}> {}

export interface StatePreviewInput {
  readonly scriptName: string;
  readonly endpoint: string;
  readonly probeSource: string;
}

const trustedEndpoint = (input: StatePreviewInput, subdomain: string) => {
  const endpoint = new URL(input.endpoint);
  if (
    !/^[a-z0-9-]+$/.test(input.scriptName) ||
    !/^[a-z0-9-]+$/.test(subdomain) ||
    endpoint.origin !== `https://${input.scriptName}.${subdomain}.workers.dev` ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Invalid preview endpoint");
  return endpoint;
};

// Cloudflare workers-sdk's create-worker-preview tests document this exchange route.
const trustedExchange = (value: string, subdomain: string) => {
  const url = new URL(value);
  const suffix = `.${subdomain}.workers.dev`;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname.endsWith(suffix) ||
    !/^[a-z0-9-]+$/.test(url.hostname.slice(0, -suffix.length)) ||
    url.pathname !== "/cdn-cgi/workers/preview/"
  )
    throw new Error("Invalid preview exchange");
  return url;
};

const readToken = (response: Response) =>
  Effect.gen(function* () {
    if (!response.ok) return yield* Effect.fail(new Error("Preview exchange rejected"));
    const body: unknown = yield* Effect.tryPromise(() => response.json());
    if (
      typeof body !== "object" ||
      body === null ||
      !("token" in body) ||
      typeof body.token !== "string" ||
      !body.token
    )
      return yield* Effect.fail(new Error("Invalid preview token"));
    return body.token;
  });

// Matches Cloudflare workers-sdk dev/create-worker-preview.ts: exchange is optional.
// Validate its destination before the fallback so unsafe URLs still fail closed.
const exchangeToken = (
  session: Workers.CreateSubdomainEdgePreviewSessionResponse,
  subdomain: string,
  fetch: typeof globalThis.fetch,
) =>
  Effect.gen(function* () {
    if (!session.exchangeUrl) return session.token;
    const url = trustedExchange(session.exchangeUrl, subdomain);
    return yield* Effect.tryPromise({
      try: (signal) => fetch(url, { signal }),
      catch: (error) => error,
    }).pipe(
      Effect.flatMap(readToken),
      Effect.catch((error) =>
        error instanceof Error && error.name === "AbortError"
          ? Effect.fail(error)
          : Effect.succeed(session.token),
      ),
    );
  });

/** Recovers the inherited secret in an authenticated preview; never deploys probe code. */
export const readStateAuth = (config: CloudflareConfig, input: StatePreviewInput) =>
  Effect.gen(function* () {
    const fetch = yield* FetchHttpClient.Fetch;
    const safeFetch: typeof globalThis.fetch = (url, init) =>
      fetch(url, {
        ...init,
        redirect: "error",
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
    return yield* recover(config, input, safeFetch).pipe(
      Retry.none,
      Effect.provide(Credentials.fromApiToken(config)),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, safeFetch),
    );
  }).pipe(
    Effect.mapError(
      () =>
        new StatePreviewError({
          message: "Unable to authorize state access through Cloudflare Worker preview",
        }),
    ),
    Effect.catchDefect(() =>
      Effect.fail(
        new StatePreviewError({
          message: "Unable to authorize state access through Cloudflare Worker preview",
        }),
      ),
    ),
  );

const recover = (
  config: CloudflareConfig,
  input: StatePreviewInput,
  fetch: typeof globalThis.fetch,
) =>
  Effect.gen(function* () {
    const account = yield* Workers.getSubdomain({ accountId: config.accountId });
    const endpoint = trustedEndpoint(input, account.subdomain);
    const session = yield* Workers.createSubdomainEdgePreviewSession({
      accountId: config.accountId,
    });
    const token = yield* exchangeToken(session, account.subdomain, fetch);
    if (!token) return yield* Effect.fail(new Error("Missing preview token"));
    const preview = yield* Workers.createScriptEdgePreview({
      accountId: config.accountId,
      scriptName: input.scriptName,
      cfPreviewUploadConfigToken: token,
      wranglerSessionConfig: { workersDev: true, minimalMode: true },
      metadata: {
        mainModule: "probe.js",
        compatibilityDate: "2026-09-21",
        bindings: [{ type: "inherit", name: "RENKIN_STATE_AUTH" }],
      },
      files: new File([input.probeSource], "probe.js", { type: "application/javascript+module" }),
    });
    const response = yield* Effect.tryPromise((signal) =>
      fetch(endpoint, {
        signal,
        headers: { "cf-workers-preview-token": preview.previewToken },
      }),
    );
    if (!response.ok) return yield* Effect.fail(new Error("Preview rejected"));
    const secret = yield* Effect.tryPromise(() => response.text());
    if (!/^[a-f0-9]{64}$/.test(secret))
      return yield* Effect.fail(new Error("Invalid state authorization secret"));
    return secret;
  });
