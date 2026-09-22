import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  Queue,
  R2Bucket,
  SendEmail,
  Workflow,
} from "@cloudflare/workers-types";
import type { BindingRequirement, KVRequirement, WorkerRequirement } from "./binding.ts";
import type { D1Requirement } from "./d1.ts";
import type { DurableObjectRequirement } from "./durable-object.ts";
import type { EmailRequirement } from "./email.ts";
import type { QueueRequirement } from "./queue.ts";
import type { R2Requirement } from "./r2.ts";
import type { R2TokenRequirement } from "./r2-token.ts";
import type { WorkflowRequirement } from "./workflow-client.ts";

type NativeBinding<B> = B extends string
  ? string
  : B extends KVRequirement
    ? KVNamespace
    : B extends D1Requirement
      ? D1Database
      : B extends R2Requirement
        ? R2Bucket
        : B extends R2TokenRequirement
          ? string
          : B extends QueueRequirement<infer Body>
            ? Queue<Body>
            : B extends WorkflowRequirement<infer Params>
              ? Workflow<Params>
              : B extends EmailRequirement
                ? SendEmail
                : B extends DurableObjectRequirement<infer Service>
                  ? DurableObjectNamespace<Service>
                  : B extends WorkerRequirement<infer Service>
                    ? Service
                    : never;

/** Native runtime handles; resource descriptors and Effect clients stay out of env. */
export type NativeBindings<B extends Readonly<Record<string, string | BindingRequirement>>> = {
  readonly [K in keyof B]: NativeBinding<B[K]>;
};
