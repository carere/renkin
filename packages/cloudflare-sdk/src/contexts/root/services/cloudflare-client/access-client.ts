import * as Access from "@distilled.cloud/cloudflare/zero-trust";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export type AccessApplicationInput = Omit<
  Access.CreateAccessApplicationForAccountRequest,
  "accountId"
>;
export type AccessPolicyInput = Omit<Access.CreateAccessPolicyRequest, "accountId">;
export type AccessServiceTokenInput = Omit<
  Access.CreateAccessServiceTokenForAccountRequest,
  "accountId" | "clientSecretVersion" | "previousClientSecretExpiresAt"
>;

export const createAccessClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const { read, write } = createOperationClient(config, gateway);
  const accountId = config.accountId;
  return {
    getApplication: (appId: string) =>
      read(Access.getAccessApplicationForAccount({ accountId, appId })),
    listApplications: (page = 1) =>
      read(Access.listAccessApplicationsForAccount({ accountId, page, perPage: 100 })),
    createApplication: (input: AccessApplicationInput, token: string) =>
      write(Access.createAccessApplicationForAccount({ ...input, accountId }), token),
    updateApplication: (appId: string, input: AccessApplicationInput, token: string) =>
      write(Access.updateAccessApplicationForAccount({ ...input, accountId, appId }), token),
    deleteApplication: (appId: string, token: string) =>
      write(Access.deleteAccessApplicationForAccount({ accountId, appId }), token),
    getPolicy: (policyId: string) => read(Access.getAccessPolicy({ accountId, policyId })),
    listPolicies: (page = 1) => read(Access.listAccessPolicies({ accountId, page, perPage: 100 })),
    createPolicy: (input: AccessPolicyInput, token: string) =>
      write(Access.createAccessPolicy({ ...input, accountId }), token),
    updatePolicy: (policyId: string, input: AccessPolicyInput, token: string) =>
      write(Access.updateAccessPolicy({ ...input, accountId, policyId }), token),
    deletePolicy: (policyId: string, token: string) =>
      write(Access.deleteAccessPolicy({ accountId, policyId }), token),
    getServiceToken: (serviceTokenId: string) =>
      read(Access.getAccessServiceTokenForAccount({ accountId, serviceTokenId })),
    listServiceTokens: (page = 1) =>
      read(Access.listAccessServiceTokensForAccount({ accountId, page, perPage: 100 })),
    createServiceToken: (input: AccessServiceTokenInput, token: string) =>
      write(Access.createAccessServiceTokenForAccount({ ...input, accountId }), token),
    updateServiceToken: (serviceTokenId: string, input: AccessServiceTokenInput, token: string) =>
      write(
        Access.updateAccessServiceTokenForAccount({ ...input, accountId, serviceTokenId }),
        token,
      ),
    deleteServiceToken: (serviceTokenId: string, token: string) =>
      write(Access.deleteAccessServiceTokenForAccount({ accountId, serviceTokenId }), token),
  };
};
