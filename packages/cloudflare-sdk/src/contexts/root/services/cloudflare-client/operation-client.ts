import * as Credentials from "@distilled.cloud/cloudflare/Credentials";
import * as Retry from "@distilled.cloud/cloudflare/Retry";
import { Effect, Schedule } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { CloudflareConfig, GatewayRequest, MutationGateway } from "./cloudflare-client.ts";

const throttled = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "TooManyRequests";

const mutationFetch =
  (config: CloudflareConfig, gateway: MutationGateway) =>
  (
    token: string,
    receipt: Pick<GatewayRequest, "operationKey" | "receiptOnly">,
  ): typeof globalThis.fetch =>
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
    const authorization = headers.authorization;
    delete headers.authorization;
    const assetUpload =
      url.pathname ===
      `${base.pathname.replace(/\/$/, "")}/accounts/${encodeURIComponent(config.accountId)}/workers/assets/upload`;
    if (
      assetUpload &&
      (request.method !== "POST" ||
        !authorization?.startsWith("Bearer ") ||
        authorization === `Bearer ${config.apiToken}`)
    )
      throw new Error("Asset uploads require a separate upload-session token.");
    const body = await request.arrayBuffer();
    const response = await gateway.request(
      {
        ...receipt,
        method: request.method,
        path: `${url.pathname.slice(base.pathname.replace(/\/$/, "").length)}${url.search}`,
        headers,
        ...(assetUpload ? { assetUploadToken: authorization?.slice(7) ?? "" } : {}),
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

/** Shared SDK transport: account-fenced mutations never retry an unknown outcome. */
export const createOperationClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const credentials = Credentials.fromApiToken(config);
  const write = <A, E, R>(
    operation: Effect.Effect<A, E, R>,
    token: string,
    receipt: Pick<GatewayRequest, "operationKey" | "receiptOnly"> = {},
  ) =>
    operation.pipe(
      Retry.none,
      Effect.provide(credentials),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, mutationFetch(config, gateway)(token, receipt)),
    );
  const read = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    operation.pipe(
      Retry.policy({
        while: throttled,
        schedule: Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed("100 millis"))),
      }),
      Effect.provide(credentials),
      Effect.provide(FetchHttpClient.layer),
    );
  return { read, write };
};
