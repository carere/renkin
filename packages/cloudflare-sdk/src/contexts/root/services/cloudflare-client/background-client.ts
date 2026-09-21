import * as Queues from "@distilled.cloud/cloudflare/queues";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import * as Workflows from "@distilled.cloud/cloudflare/workflows";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export type QueueConsumerSettings = Omit<
  Queues.ConsumersCreateRequestSettingsWorker,
  "maxConcurrency"
> & { readonly maxConcurrency?: number | null };
type ConsumerInput = Omit<Queues.CreateConsumerRequest, "accountId" | "settings"> & {
  readonly settings?: QueueConsumerSettings;
};

/** rc.12 omits list pagination inputs. Preserve its decoder while supplying the documented query. */
const queuePage =
  (page: number): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== "GET" || !url.pathname.endsWith("/queues"))
      throw new Error("Unexpected queue page request.");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    return fetch(url, request);
  };
export const createBackgroundClient = (config: CloudflareConfig, gateway: MutationGateway) => {
  const transport = createOperationClient(config, gateway);
  const accountId = config.accountId;
  return {
    listQueues: (page: number) =>
      transport
        .read(Queues.listQueues({ accountId }))
        .pipe(Effect.provideService(FetchHttpClient.Fetch, queuePage(page))),
    getQueue: (queueId: string) => transport.read(Queues.getQueue({ accountId, queueId })),
    createQueue: (queueName: string, token: string) =>
      transport.write(Queues.createQueue({ accountId, queueName }), token),
    updateQueue: (input: Omit<Queues.UpdateQueueRequest, "accountId">, token: string) =>
      transport.write(Queues.updateQueue({ accountId, ...input }), token),
    deleteQueue: (queueId: string, token: string) =>
      transport.write(Queues.deleteQueue({ accountId, queueId }), token),
    createConsumer: (input: ConsumerInput, token: string) =>
      transport.write(
        Queues.createConsumer({ accountId, ...input } as Queues.CreateConsumerRequest),
        token,
      ),
    updateConsumer: (input: ConsumerInput & { readonly consumerId: string }, token: string) =>
      transport.write(
        Queues.updateConsumer({ accountId, ...input } as Queues.UpdateConsumerRequest),
        token,
      ),
    deleteConsumer: (queueId: string, consumerId: string, token: string) =>
      transport.write(Queues.deleteConsumer({ accountId, queueId, consumerId }), token),
    listWorkflows: (page: number) =>
      transport.read(Workflows.listWorkflows({ accountId, page, perPage: 100 })),
    getWorkflow: (workflowName: string) =>
      transport.read(Workflows.getWorkflow({ accountId, workflowName })),
    putWorkflow: (input: Omit<Workflows.PutWorkflowRequest, "accountId">, token: string) =>
      transport.write(Workflows.putWorkflow({ accountId, ...input }), token),
    deleteWorkflow: (workflowName: string, token: string) =>
      transport.write(Workflows.deleteWorkflow({ accountId, workflowName }), token),
    getSchedules: (scriptName: string) =>
      transport.read(Workers.getScriptSchedule({ accountId, scriptName })),
    putSchedules: (scriptName: string, crons: readonly string[], token: string) =>
      transport.write(
        Workers.putScriptSchedule({ accountId, scriptName, body: crons.map((cron) => ({ cron })) }),
        token,
      ),
  };
};
