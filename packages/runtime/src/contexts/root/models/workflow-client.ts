import type { Workflow } from "@cloudflare/workers-types";
import { Effect } from "effect";

export interface WorkflowRequirement<Params = unknown> {
  readonly type: "cloudflare.workflow";
  readonly id: string;
  readonly paramsType?: Params;
}
export type NativeWorkflow<Params = unknown> = Workflow<Params>;
export class WorkflowError extends Error {
  readonly name = "WorkflowError";
  constructor(
    readonly binding: string,
    readonly operation: string,
  ) {
    super(`Workflow ${binding} failed during ${operation}.`);
  }
}
export const workflowClient = <Params>(native: NativeWorkflow<Params>, binding: string) => ({
  native,
  create: (options?: Parameters<NativeWorkflow<Params>["create"]>[0]) =>
    Effect.tryPromise({
      try: () => native.create(options),
      catch: () => new WorkflowError(binding, "create"),
    }),
  createBatch: (options: Parameters<NativeWorkflow<Params>["createBatch"]>[0]) =>
    Effect.tryPromise({
      try: () => native.createBatch(options),
      catch: () => new WorkflowError(binding, "createBatch"),
    }),
  get: (id: string) =>
    Effect.tryPromise({
      try: () => native.get(id),
      catch: () => new WorkflowError(binding, "get"),
    }),
});
export type WorkflowClient<Params = unknown> = ReturnType<typeof workflowClient<Params>>;
