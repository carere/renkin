import { cloudflareAccessServices } from "@renkin/cloudflare/services/access/cloudflare-access-service";
import { cloudflareQueueService } from "@renkin/cloudflare/services/background/cloudflare-queue-service";
import { cloudflareWorkflowService } from "@renkin/cloudflare/services/background/cloudflare-workflow-service";
import { cloudflareD1Service } from "@renkin/cloudflare/services/d1/cloudflare-d1-service";
import { cloudflareDurableObjectService } from "@renkin/cloudflare/services/durable-object/cloudflare-durable-object-service";
import { cloudflareKVService } from "@renkin/cloudflare/services/kv/cloudflare-kv-service";
import { cloudflareR2Service } from "@renkin/cloudflare/services/r2/cloudflare-r2-service";
import { cloudflareR2TokenService } from "@renkin/cloudflare/services/r2-token/cloudflare-r2-token-service";
import { cloudflareSiteServices } from "@renkin/cloudflare/services/site/cloudflare-site-service";
import {
  type CloudStateOptions,
  ensureCloudflareState,
  findCloudflareState,
} from "@renkin/cloudflare/services/state/bootstrap-cloudflare-state";
import { CloudflareStateRepository } from "@renkin/cloudflare/services/state/cloudflare-state-repository";
import { cloudflareWorkerService } from "@renkin/cloudflare/services/worker/cloudflare-worker-service";
import { createAccessClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/access-client";
import { createAccountTokenClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/account-token-client";
import { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import {
  createBootstrapClient,
  createCloudflareClient,
  type GatewayRequest,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createD1Client } from "@renkin/cloudflare-sdk/services/cloudflare-client/d1-client";
import { createDurableObjectClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/durable-object-client";
import { createKVClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/kv-client";
import { createR2Client } from "@renkin/cloudflare-sdk/services/cloudflare-client/r2-client";
import { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceServices } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";

export interface CloudflareOptions {
  readonly accountId?: string;
  readonly apiToken?: string;
  readonly stateScriptName?: string;
  /** Separate, explicit account-owned token management authorization. Never persisted in state. */
  readonly tokenManagementApiToken?: string;
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
    endpoint,
    stateAuthToken,
    state: new CloudflareStateRepository({ endpoint, stateAuthToken, apiToken: config.apiToken }),
  };
};

const accountSubdomain = async (config: CloudStateOptions) => {
  const { subdomain } = await Effect.runPromise(
    createBootstrapClient(config).getAccountSubdomain(),
  );
  if (!subdomain) throw new Error("Cloudflare account has no workers.dev subdomain.");
  return subdomain;
};

export const cloudEnvironment = async (
  stack: string,
  environment: string,
  options?: CloudflareOptions,
  desired: readonly ResourceDefinition[] = [],
) => {
  const { config, state, endpoint, stateAuthToken } = await cloudState(options);
  const managementState = options?.tokenManagementApiToken
    ? new CloudflareStateRepository({
        endpoint,
        stateAuthToken,
        apiToken: options.tokenManagementApiToken,
      })
    : undefined;
  const accountTokenClient =
    managementState && options?.tokenManagementApiToken
      ? createAccountTokenClient(
          { ...config, apiToken: options.tokenManagementApiToken },
          {
            request: (request, token) =>
              managementState.gateway(stack, environment, token, request),
          },
        )
      : undefined;
  const subdomain = await accountSubdomain(config);
  const gateway = {
    request: (request: GatewayRequest, token: string) =>
      state.gateway(stack, environment, token, request),
  };
  const client = createCloudflareClient(config, gateway);
  const kvClient = createKVClient(config, gateway);
  const siteClient = createSiteClient(config, gateway);
  const accessClient = createAccessClient(config, gateway);
  const d1Client = createD1Client(config, gateway);
  const durableObjectClient = createDurableObjectClient(config, gateway);
  const r2Client = createR2Client(config, gateway);
  const backgroundClient = createBackgroundClient(config, gateway);
  const services: ResourceServices = (lease) => ({
    ...cloudflareAccessServices({ client: accessClient, token: lease.token }),
    ...cloudflareSiteServices({ client: siteClient, token: lease.token }),
    "cloudflare.queue": cloudflareQueueService(backgroundClient, lease.token),
    "cloudflare.workflow": cloudflareWorkflowService(backgroundClient, lease.token),
    "cloudflare.d1": cloudflareD1Service(d1Client, lease.token),
    ...(accountTokenClient
      ? {
          "cloudflare.r2-token": cloudflareR2TokenService(
            accountTokenClient,
            config.accountId,
            lease.token,
          ),
        }
      : {}),
    "cloudflare.r2": cloudflareR2Service(r2Client, lease.token),
    "cloudflare.kv": cloudflareKVService(kvClient, lease.token),
    "cloudflare.durable-object": cloudflareDurableObjectService({
      client: durableObjectClient,
      workers: client,
      token: lease.token,
      stack,
      environment,
      desired,
    }),
    "cloudflare.worker": cloudflareWorkerService({
      client,
      siteClient,
      durableObjectClient,
      desired,
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
