import * as Credentials from "@distilled.cloud/cloudflare/Credentials";
import * as Retry from "@distilled.cloud/cloudflare/Retry";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { DurableObjectExports } from "../../models/durable-object-exports.ts";
import { createOperationClient } from "./operation-client.ts";

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
  /** Only accepted for the account's exact Workers asset upload endpoint. */
  readonly assetUploadToken?: string;
  readonly operationKey?: string;
  readonly receiptOnly?: boolean;
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

export type WorkerUpload = Omit<Workers.PutScriptRequest, "accountId" | "metadata"> & {
  readonly metadata: NonNullable<Workers.PutScriptRequest["metadata"]> & {
    readonly exports?: DurableObjectExports;
  };
};

const setup = (config: CloudflareConfig) => {
  if (!config.accountId.trim() || !config.apiToken.trim()) {
    throw new Error("Cloudflare account ID and API token are required");
  }
  return Credentials.fromApiToken(config);
};

/** Read errors remain Distilled tagged errors, including WorkerNotFound. */
export const createCloudflareClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const { write, read } = createOperationClient(config, gateway);
  return {
    getWorker: (scriptName: string) =>
      read(Workers.getScriptScriptAndVersionSetting({ accountId: config.accountId, scriptName })),
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
    getWorkerSubdomain: (scriptName: string) =>
      run(Workers.getScriptSubdomain({ accountId: config.accountId, scriptName })),
    getAccountSubdomain: () => run(Workers.getSubdomain({ accountId: config.accountId })),
  };
};
