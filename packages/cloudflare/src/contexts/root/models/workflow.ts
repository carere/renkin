import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { WorkflowRequirement } from "@renkin/runtime/models/workflow-client";

export interface WorkflowOptions {
  readonly worker: string;
  readonly className: string;
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  readonly identity?: string;
}
export interface WorkflowResource<Params = unknown>
  extends ResourceDefinition,
    WorkflowRequirement<Params> {
  readonly type: "cloudflare.workflow";
}
export const workflow = <Params = unknown>(
  id: string,
  options: WorkflowOptions,
): WorkflowResource<Params> => ({
  id,
  type: "cloudflare.workflow",
  identity: options.identity ?? "workflow",
  properties: { worker: options.worker, className: options.className },
  dependencies: [options.worker],
  protection: { data: true, allowDelete: options.allowDelete ?? false },
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
