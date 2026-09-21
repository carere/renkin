import * as Credentials from "@distilled.cloud/cloudflare/Credentials";
import * as Retry from "@distilled.cloud/cloudflare/Retry";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import { Effect, Schedule } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

export interface CloudflareConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly apiBaseUrl?: string;
}

export interface GatewayRequest {
  readonly method: string;
  readonly path: string;
  readonly bodyBase64?: string;
  readonly headers?: Record<string, string>;
}

export interface GatewayResponse {
  readonly status: number;
  readonly bodyBase64?: string;
  readonly headers: Record<string, string>;
}

/** The coordinator validates the fencing token at the point of dispatch. */
export interface MutationGateway {
  readonly request: (request: GatewayRequest, token: string) => Promise<GatewayResponse>;
}

export type WorkerUpload = Omit<Workers.PutScriptRequest, "accountId">;

const throttled = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "TooManyRequests";

const setup = (config: CloudflareConfig) => {
  if (!config.accountId.trim() || !config.apiToken.trim()) {
    throw new Error("Cloudflare account ID and API token are required");
  }
  return Credentials.fromApiToken(config);
};

/** Read errors remain Distilled tagged errors, including WorkerNotFound. */
export const createCloudflareClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const credentials = setup(config);
  const mutationFetch =
    (token: string): typeof globalThis.fetch =>
    async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const base = new URL(config.apiBaseUrl ?? Credentials.DEFAULT_API_BASE_URL);
      if (
        url.origin !== base.origin ||
        !url.pathname.startsWith(
          `${base.pathname.replace(/\/$/, "")}/accounts/${encodeURIComponent(config.accountId)}/`,
        )
      ) {
        throw new Error("Cloudflare mutation is outside the configured account");
      }
      const headers = Object.fromEntries(request.headers);
      delete headers.authorization;
      const body = await request.arrayBuffer();
      const response = await gateway.request(
        {
          method: request.method,
          path: `${url.pathname.slice(base.pathname.replace(/\/$/, "").length)}${url.search}`,
          headers,
          ...(body.byteLength ? { bodyBase64: Buffer.from(body).toString("base64") } : {}),
        },
        token,
      );
      return new Response(
        response.bodyBase64 === undefined ? null : Buffer.from(response.bodyBase64, "base64"),
        {
          status: response.status,
          headers: response.headers,
        },
      );
    };
  const write = <A, E, R>(operation: Effect.Effect<A, E, R>, token: string) =>
    operation.pipe(
      Retry.none,
      Effect.provide(credentials),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, mutationFetch(token)),
    );
  return {
    getWorker: (scriptName: string) =>
      Workers.getScriptScriptAndVersionSetting({ accountId: config.accountId, scriptName }).pipe(
        Retry.policy({
          while: throttled,
          schedule: Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed("100 millis"))),
        }),
        Effect.provide(credentials),
        Effect.provide(FetchHttpClient.layer),
      ),
    putWorker: (input: WorkerUpload, token: string) =>
      write(Workers.putScript({ ...input, accountId: config.accountId }), token),
    enableWorkerSubdomain: (scriptName: string, token: string) =>
      write(
        Workers.createScriptSubdomain({ accountId: config.accountId, scriptName, enabled: true }),
        token,
      ),
    deleteWorker: (scriptName: string, token: string) =>
      write(Workers.deleteScript({ accountId: config.accountId, scriptName }), token),
  };
};

/** Account bootstrap only: installing the coordinator precedes environment locks. */
export const createBootstrapClient = (config: CloudflareConfig) => {
  const credentials = setup(config);
  const run = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    operation.pipe(Retry.none, Effect.provide(credentials), Effect.provide(FetchHttpClient.layer));
  return {
    getWorker: (scriptName: string) =>
      run(Workers.getScriptScriptAndVersionSetting({ accountId: config.accountId, scriptName })),
    putWorker: (input: WorkerUpload) =>
      run(Workers.putScript({ ...input, accountId: config.accountId })),
    enableWorkerSubdomain: (scriptName: string) =>
      run(
        Workers.createScriptSubdomain({ accountId: config.accountId, scriptName, enabled: true }),
      ),
    getAccountSubdomain: () => run(Workers.getSubdomain({ accountId: config.accountId })),
  };
};
