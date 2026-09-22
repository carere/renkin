import type { WorkerUpload } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { Json } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import {
  backgroundProperties as object,
  stringProperty,
} from "#src/contexts/root/services/background/background-properties.ts";

type Binding = NonNullable<NonNullable<WorkerUpload["metadata"]>["bindings"]>[number];
export const backgroundBinding = (
  name: string,
  requirement: Readonly<Record<string, Json>>,
  target: ResourceState | undefined,
): Binding => {
  if (requirement.type === "cloudflare.queue") {
    if (target?.definition.type !== "cloudflare.queue")
      throw new Error("Queue binding target is not provisioned.");
    return { type: "queue", name, queueName: stringProperty(target.outputs, "name") };
  }
  if (requirement.type === "cloudflare.workflow") {
    if (target?.definition.type !== "cloudflare.workflow")
      throw new Error("Workflow binding target is not provisioned.");
    return {
      type: "workflow",
      name,
      workflowName: target.physicalId,
      className: stringProperty(target.outputs, "className"),
      scriptName: stringProperty(target.outputs, "scriptName"),
    };
  }
  const options = object(requirement.options);
  return {
    type: "send_email",
    name,
    ...(typeof options.destinationAddress === "string"
      ? { destinationAddress: options.destinationAddress }
      : {}),
    ...(Array.isArray(options.allowedDestinationAddresses)
      ? { allowedDestinationAddresses: options.allowedDestinationAddresses as string[] }
      : {}),
    ...(Array.isArray(options.allowedSenderAddresses)
      ? { allowedSenderAddresses: options.allowedSenderAddresses as string[] }
      : {}),
  };
};
