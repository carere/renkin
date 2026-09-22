import type { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
import { stringProperty } from "./background-properties.ts";

type Client = ReturnType<typeof createBackgroundClient>;
const observe = (client: Client, name: string) =>
  client
    .getWorkflow(name)
    .pipe(Effect.catchTag("WorkflowNotFound", () => Effect.succeed(undefined)));
export const cloudflareWorkflowService = (client: Client, token: string): ResourceService => ({
  deferredBindings: true,
  refresh: true,
  apply: (definition, workflowName, previous, resources = {}) =>
    Effect.gen(function* () {
      const owner = resources[stringProperty(definition.properties, "worker")];
      if (owner?.definition.type !== "cloudflare.worker")
        return yield* Effect.fail(new Error("Workflow owner has not been provisioned."));
      const className = stringProperty(definition.properties, "className");
      const observed = yield* observe(client, workflowName);
      const updating = previous?.physicalId === workflowName;
      const expectedOwner =
        updating && previous ? stringProperty(previous.outputs, "scriptName") : owner.physicalId;
      const expectedClass =
        updating && previous ? stringProperty(previous.outputs, "className") : className;
      if (
        observed &&
        (observed.name !== workflowName ||
          observed.scriptName !== expectedOwner ||
          observed.className !== expectedClass)
      )
        return yield* Effect.fail(
          new Error("Workflow ownership differs from the recorded resource."),
        );
      const result =
        observed?.scriptName === owner.physicalId && observed.className === className
          ? observed
          : yield* client.putWorkflow(
              { workflowName, scriptName: owner.physicalId, className },
              token,
            );
      return { id: result.id, name: workflowName, scriptName: owner.physicalId, className };
    }),
  remove: (resource) =>
    Effect.gen(function* () {
      const observed = yield* observe(client, resource.physicalId);
      if (!observed) return;
      if (
        observed.name !== resource.physicalId ||
        observed.scriptName !== stringProperty(resource.outputs, "scriptName") ||
        observed.className !== stringProperty(resource.outputs, "className")
      )
        return yield* Effect.fail(
          new Error("Workflow ownership differs from the recorded resource."),
        );
      yield* client.deleteWorkflow(resource.physicalId, token);
    }),
});
