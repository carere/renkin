import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerOptions } from "miniflare";
import type { Requirements } from "#src/contexts/root/models/binding.ts";

export interface LocalWorkflow {
  readonly name: string;
  readonly className: string;
  readonly scriptName: string;
}
export interface LocalQueue {
  readonly name: string;
  readonly deliveryDelay?: number | undefined;
}
export interface LocalQueueConsumer {
  readonly queue: { readonly id: string };
  readonly deadLetterQueue?: { readonly id: string };
  readonly maxBatchSize?: number;
  readonly maxBatchTimeout?: number;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
}
export interface LocalBackgroundOptions {
  readonly queues?: Readonly<Record<string, LocalQueue>>;
  readonly workflows?: Readonly<Record<string, LocalWorkflow>>;
}
const queue = (id: string, options: LocalBackgroundOptions) => {
  const target = options.queues?.[id];
  if (!target) throw new Error(`Queue ${id} is not declared in the stack.`);
  return target;
};
export const localBackgroundOptions = (
  requirements: Requirements,
  consumers: readonly LocalQueueConsumer[],
  options: LocalBackgroundOptions,
): Pick<WorkerOptions, "queueProducers" | "queueConsumers" | "workflows" | "email"> => {
  const queueProducers: Record<string, { queueName: string; deliveryDelay?: number | undefined }> =
    {};
  const workflows: Record<string, LocalWorkflow> = {};
  const send_email: NonNullable<NonNullable<WorkerOptions["email"]>["send_email"]> = [];
  for (const [name, requirement] of Object.entries(requirements)) {
    if (requirement.type === "cloudflare.queue") {
      const target = queue(requirement.id, options);
      queueProducers[name] = { queueName: target.name, deliveryDelay: target.deliveryDelay };
    } else if (requirement.type === "cloudflare.workflow") {
      const target = options.workflows?.[requirement.id];
      if (!target) throw new Error(`Workflow ${requirement.id} is not declared in the stack.`);
      workflows[name] = target;
    } else if (requirement.type === "cloudflare.email") {
      const email = requirement.options;
      send_email.push({
        name,
        ...(email.destinationAddress
          ? { destination_address: email.destinationAddress }
          : email.allowedDestinationAddresses
            ? { allowed_destination_addresses: [...email.allowedDestinationAddresses] }
            : {}),
        ...(email.allowedSenderAddresses
          ? { allowed_sender_addresses: [...email.allowedSenderAddresses] }
          : {}),
      });
    }
  }
  const queueConsumers = Object.fromEntries(
    consumers.map(({ queue: resource, deadLetterQueue, ...policy }) => [
      queue(resource.id, options).name,
      {
        ...policy,
        ...(deadLetterQueue ? { deadLetterQueue: queue(deadLetterQueue.id, options).name } : {}),
      },
    ]),
  );
  return { queueProducers, queueConsumers, workflows, email: { send_email } };
};

/** Reads native Miniflare capture files; no email is sent over the network locally. */
export const capturedEmails = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { recursive: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return Promise.all(
    entries
      .filter((path) => path.endsWith(".eml"))
      .sort()
      .map((path) => readFile(join(directory, path), "utf8")),
  );
};

export const workflowNames = (requirements: Requirements, options: LocalBackgroundOptions) =>
  Object.fromEntries(
    Object.entries(requirements).flatMap(([binding, requirement]) =>
      requirement.type === "cloudflare.workflow"
        ? [[binding, options.workflows?.[requirement.id]?.name]]
        : [],
    ),
  );
