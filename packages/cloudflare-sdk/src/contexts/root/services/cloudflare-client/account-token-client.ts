import * as Accounts from "@distilled.cloud/cloudflare/accounts";
import { Stream } from "effect";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export type AccountTokenInput = Omit<Accounts.CreateTokenRequest, "accountId">;
/** Explicit account token-management credentials; writes are fenced and never retried blindly. */
export const createAccountTokenClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const { read, write } = createOperationClient(config, gateway);
  const accountId = config.accountId;
  return {
    permissions: () => read(Accounts.listTokensPermissionGroups({ accountId })),
    list: () =>
      read(Accounts.listTokens.items({ accountId, includeExpired: true }).pipe(Stream.runCollect)),
    get: (tokenId: string) => read(Accounts.getToken({ accountId, tokenId })),
    create: (input: AccountTokenInput, leaseToken: string, operationKey: string) =>
      write(Accounts.createToken({ ...input, accountId }), leaseToken, { operationKey }),
    replay: (input: AccountTokenInput, leaseToken: string, operationKey: string) =>
      write(Accounts.createToken({ ...input, accountId }), leaseToken, {
        operationKey,
        receiptOnly: true,
      }),
    remove: (tokenId: string, leaseToken: string) =>
      write(Accounts.deleteToken({ accountId, tokenId }), leaseToken),
  };
};
