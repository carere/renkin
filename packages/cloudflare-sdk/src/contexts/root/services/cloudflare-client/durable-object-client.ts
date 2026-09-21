import * as DurableObjects from "@distilled.cloud/cloudflare/durable-objects";
import { Effect } from "effect";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

/** Namespace creation and retirement belong to the owning Worker's class exports. */
export const createDurableObjectClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const { read } = createOperationClient(config, gateway);
  return {
    list: () =>
      Effect.gen(function* () {
        const namespaces: DurableObjects.NamespacesListResultItem[] = [];
        for (let page = 1; ; page++) {
          const response = yield* read(
            DurableObjects.listNamespaces({ accountId: config.accountId, page, perPage: 100 }),
          );
          namespaces.push(...response.result);
          if (response.result.length < 100) return namespaces;
        }
      }),
  };
};
