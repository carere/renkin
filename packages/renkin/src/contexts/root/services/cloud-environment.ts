import { cloudflareD1Service } from "@renkin/cloudflare/services/d1/cloudflare-d1-service";
import { cloudflareKVService } from "@renkin/cloudflare/services/kv/cloudflare-kv-service";
import {
  type CloudStateOptions,
  ensureCloudflareState,
  findCloudflareState,
} from "@renkin/cloudflare/services/state/bootstrap-cloudflare-state";
import { CloudflareStateRepository } from "@renkin/cloudflare/services/state/cloudflare-state-repository";
import { cloudflareWorkerService } from "@renkin/cloudflare/services/worker/cloudflare-worker-service";
import {
  createBootstrapClient,
  createCloudflareClient,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createD1Client } from "@renkin/cloudflare-sdk/services/cloudflare-client/d1-client";
import { createKVClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/kv-client";
import { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { ResourceServices } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";

export interface CloudflareOptions {
  readonly accountId?: string;
  readonly apiToken?: string;
  readonly stateScriptName?: string;
}

const cloudCredentials = (options: CloudflareOptions = {}): CloudStateOptions => {
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken)
    throw new Error("Cloud deployment requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  return {
    accountId,
    apiToken,
    ...(options.stateScriptName ? { stateScriptName: options.stateScriptName } : {}),
  };
};

const cloudState = async (options?: CloudflareOptions) => {
  const config = cloudCredentials(options);
  const { endpoint, stateAuthToken } = await ensureCloudflareState(config);
  return {
    config,
    state: new CloudflareStateRepository({ endpoint, stateAuthToken, apiToken: config.apiToken }),
  };
};

export const cloudEnvironment = async (
  stack: string,
  environment: string,
  options?: CloudflareOptions,
) => {
  const { config, state } = await cloudState(options);
  const { subdomain } = await Effect.runPromise(
    createBootstrapClient(config).getAccountSubdomain(),
  );
  if (!subdomain) throw new Error("Cloudflare account has no workers.dev subdomain.");
  const client = createCloudflareClient(config, {
    request: (request, token) => state.gateway(stack, environment, token, request),
  });
  const kvClient = createKVClient(config, {
    request: (request, token) => state.gateway(stack, environment, token, request),
  });
  const siteClient = createSiteClient(config, {
    request: (request, token) => state.gateway(stack, environment, token, request),
  });
  const d1Client = createD1Client(config, {
    request: (request, token) => state.gateway(stack, environment, token, request),
  });
  const services: ResourceServices = (lease) => ({
    "cloudflare.kv": cloudflareKVService(kvClient, lease.token),
    "cloudflare.d1": cloudflareD1Service(d1Client, lease.token),
    "cloudflare.worker": cloudflareWorkerService({
      client,
      siteClient,
      token: lease.token,
      stack,
      environment,
      subdomain,
    }),
  });
  return { state, services };
};

/** Inspection never provisions state infrastructure or changes endpoint settings. */
export const readCloudState = async (options?: CloudflareOptions) => {
  const config = cloudCredentials(options);
  const located = await findCloudflareState(config);
  return located
    ? new CloudflareStateRepository({
        endpoint: located.endpoint,
        stateAuthToken: located.stateAuthToken,
        apiToken: config.apiToken,
      })
    : undefined;
};
