import type { KVNamespace } from "@cloudflare/workers-types";
import { Effect } from "effect";
import { type D1Client, type D1Requirement, d1Client, type NativeD1 } from "./d1.ts";
import { type EmailClient, type EmailRequirement, emailClient, type NativeEmail } from "./email.ts";
import { type NativeQueue, type QueueClient, type QueueRequirement, queueClient } from "./queue.ts";
import {
  type NativeWorkflow,
  type WorkflowClient,
  type WorkflowRequirement,
  workflowClient,
} from "./workflow-client.ts";

export interface KVRequirement {
  readonly type: "cloudflare.kv";
  readonly id: string;
}
export interface WorkerRequirement<
  Service = { fetch(request: Request | string | URL, init?: RequestInit): Promise<Response> },
> {
  readonly type: "cloudflare.worker-reference";
  readonly id: string;
  readonly entrypoint?: string;
  readonly external?: { readonly name: string; readonly localEntry?: string };
  readonly serviceType?: Service;
}
export type BindingRequirement =
  | KVRequirement
  | D1Requirement
  | WorkerRequirement<unknown>
  | QueueRequirement
  | WorkflowRequirement
  | EmailRequirement;
export type Requirements = Readonly<Record<string, BindingRequirement>>;
export type NativeKV = KVNamespace;
export class BindingError extends Error {
  readonly name = "BindingError";
  constructor(
    readonly binding: string,
    readonly operation: string,
  ) {
    super(`Binding ${binding} failed during ${operation}.`);
  }
}
const call = <A>(binding: string, operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new BindingError(binding, operation) });
export const kvClient = (native: NativeKV, binding: string) => ({
  native,
  get: (key: string) => call(binding, "get", () => native.get(key)),
  getJson: <T>(key: string) => call(binding, "get", () => native.get<T>(key, "json")),
  put: (
    key: string,
    value: Parameters<NativeKV["put"]>[1],
    options?: Parameters<NativeKV["put"]>[2],
  ) => call(binding, "put", () => native.put(key, value, options)),
  delete: (key: string) => call(binding, "delete", () => native.delete(key)),
  list: (options?: Parameters<NativeKV["list"]>[0]) =>
    call(binding, "list", () => native.list(options)),
});
export type KVClient = ReturnType<typeof kvClient>;
export type WorkerClient<Service> = {
  readonly native: Service;
  readonly call: <A>(operation: (service: Service) => Promise<A>) => Effect.Effect<A, BindingError>;
};
export type Resolved<R extends Requirements> = {
  readonly [K in keyof R]: R[K] extends KVRequirement
    ? KVClient
    : R[K] extends D1Requirement
      ? D1Client
      : R[K] extends QueueRequirement<infer Body>
        ? QueueClient<Body>
        : R[K] extends WorkflowRequirement<infer Params>
          ? WorkflowClient<Params>
          : R[K] extends EmailRequirement
            ? EmailClient
            : R[K] extends WorkerRequirement<infer Service>
              ? WorkerClient<Service>
              : never;
};
export const resolveBindings = <R extends Requirements>(
  requirements: R,
  env: Record<string, unknown>,
): Resolved<R> =>
  Object.fromEntries(
    Object.entries(requirements).map(([name, requirement]) => {
      const native = env[name];
      if (!native) throw new BindingError(name, "resolve");
      return [
        name,
        requirement.type === "cloudflare.kv"
          ? kvClient(native as NativeKV, name)
          : requirement.type === "cloudflare.d1"
            ? d1Client(native as NativeD1, name)
            : requirement.type === "cloudflare.queue"
              ? queueClient(native as NativeQueue, name)
              : requirement.type === "cloudflare.workflow"
                ? workflowClient(native as NativeWorkflow, name)
                : requirement.type === "cloudflare.email"
                  ? emailClient(native as NativeEmail, name)
                  : {
                      native,
                      call: <A>(operation: (service: unknown) => Promise<A>) =>
                        call(name, "rpc", () => operation(native)),
                    },
      ];
    }),
  ) as Resolved<R>;
export const workerReference = <
  Service = { fetch(request: Request | string | URL, init?: RequestInit): Promise<Response> },
>(
  id: string,
  options: { readonly entrypoint?: string } = {},
): WorkerRequirement<NoInfer<Service>> => ({ type: "cloudflare.worker-reference", id, ...options });
export const externalWorker = <
  Service = { fetch(request: Request | string | URL, init?: RequestInit): Promise<Response> },
>(
  name: string,
  options: { readonly entrypoint?: string; readonly localEntry?: string } = {},
): WorkerRequirement<NoInfer<Service>> => ({
  type: "cloudflare.worker-reference",
  id: name,
  ...(options.entrypoint ? { entrypoint: options.entrypoint } : {}),
  external: { name, ...(options.localEntry ? { localEntry: options.localEntry } : {}) },
});
