import type { Miniflare, V4WorkerOptions as WorkerOptions } from "miniflare";
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
  const queueProducers: Record<string, { queueName: string; deliveryDelay?: number }> = {};
  const workflows: Record<string, LocalWorkflow> = {};
  const send_email: NonNullable<NonNullable<WorkerOptions["email"]>["send_email"]> = [];
  for (const [name, requirement] of Object.entries(requirements)) {
    if (requirement.type === "cloudflare.queue") {
      const target = queue(requirement.id, options);
      queueProducers[name] = {
        queueName: target.name,
        ...(target.deliveryDelay === undefined ? {} : { deliveryDelay: target.deliveryDelay }),
      };
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

interface CapturedEmail {
  readonly messageId: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly replyTo?: string;
  readonly subject: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly html?: string;
  readonly raw?: string;
}

/** One string per native send; multipart representations are parts of that string. */
const renderEmail = (email: CapturedEmail): string => {
  if (email.raw !== undefined) return email.raw;
  const headers = [
    `From: ${email.from}`,
    `To: ${email.to.join(", ")}`,
    `Subject: ${email.subject}`,
    `Message-ID: ${email.messageId}`,
    ...(email.cc ? [`Cc: ${email.cc.join(", ")}`] : []),
    ...(email.bcc ? [`Bcc: ${email.bcc.join(", ")}`] : []),
    ...(email.replyTo ? [`Reply-To: ${email.replyTo}`] : []),
    ...Object.entries(email.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
    "MIME-Version: 1.0",
  ];
  const parts = [
    ...(email.text === undefined ? [] : [{ type: "text/plain", body: email.text }]),
    ...(email.html === undefined ? [] : [{ type: "text/html", body: email.html }]),
  ];
  const boundary = `renkin-${Buffer.from(email.messageId).toString("hex")}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...parts.flatMap((part) => [
      `--${boundary}`,
      `Content-Type: ${part.type}; charset=utf-8`,
      "Content-Transfer-Encoding: 8bit",
      "",
      part.body,
    ]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
};

/** Read the session-local native store, never the explorer's cross-process aggregate. */
export const capturedEmails =
  (runtime: Miniflare, workers: readonly { readonly id: string }[]) =>
  async (): Promise<readonly string[]> => {
    const read = async <A>(
      query: URLSearchParams,
    ): Promise<{
      result: A;
      result_info?: { has_more?: boolean; cursor?: string };
      messages?: readonly { code: number; message: string }[];
    }> => {
      const response = await runtime.dispatchFetch(
        `http://localhost/cdn-cgi/local/explorer/api/local/email/sending?${query}`,
      );
      if (!response.ok) throw new Error(`Could not read captured email: ${response.status}`);
      return (await response.json()) as {
        result: A;
        result_info?: { has_more?: boolean; cursor?: string };
        messages?: readonly { code: number; message: string }[];
      };
    };
    const messages: string[] = [];
    for (const { id: worker } of workers) {
      const query = new URLSearchParams({ worker, per_page: "100" });
      for (;;) {
        const page = await read<readonly CapturedEmail[]>(query);
        for (const item of page.result) {
          const detail = await read<CapturedEmail>(
            new URLSearchParams({ worker, email_id: item.messageId }),
          );
          if (detail.messages?.length)
            throw new Error(detail.messages.map((message) => message.message).join("; "));
          messages.push(renderEmail(detail.result));
        }
        if (!page.result_info?.has_more) break;
        if (!page.result_info.cursor)
          throw new Error("Captured email pagination cursor is missing.");
        query.set("cursor", page.result_info.cursor);
      }
    }
    return messages;
  };

export const workflowNames = (requirements: Requirements, options: LocalBackgroundOptions) =>
  Object.fromEntries(
    Object.entries(requirements).flatMap(([binding, requirement]) => {
      if (requirement.type !== "cloudflare.workflow") return [];
      const target = options.workflows?.[requirement.id];
      if (!target) throw new Error(`Workflow ${requirement.id} is not declared in the stack.`);
      return [[binding, target.name]];
    }),
  );
