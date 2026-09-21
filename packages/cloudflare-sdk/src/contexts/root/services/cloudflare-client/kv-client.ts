import * as KV from "@distilled.cloud/cloudflare/kv";
import { Effect } from "effect";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export const createKVClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const { read, write } = createOperationClient(config, gateway);
  return {
    list: () =>
      Effect.gen(function* () {
        const result: KV.NamespacesListResultItem[] = [];
        for (let page = 1; ; page++) {
          const response = yield* read(
            KV.listNamespaces({ accountId: config.accountId, page, perPage: 1000 }),
          );
          result.push(...response.result);
          if (response.result.length < 1000) return result;
        }
      }),
    get: (namespaceId: string) =>
      read(KV.getNamespace({ accountId: config.accountId, namespaceId })),
    create: (title: string, jurisdiction: string | undefined, token: string) =>
      write(
        KV.createNamespace({
          accountId: config.accountId,
          title,
          ...(jurisdiction ? { jurisdiction } : {}),
        }),
        token,
      ),
    remove: (namespaceId: string, token: string) =>
      write(KV.deleteNamespace({ accountId: config.accountId, namespaceId }), token),
  };
};
