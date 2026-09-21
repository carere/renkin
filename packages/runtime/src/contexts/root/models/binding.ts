import { Effect } from "effect";

export interface KVRequirement {
  readonly type: "cloudflare.kv";
  readonly id: string;
}
export interface WorkerRequirement<Service = { fetch(request: Request): Promise<Response> }> {
  readonly type: "cloudflare.worker-reference";
  readonly id: string;
  readonly entrypoint?: string;
  readonly external?: { readonly name: string; readonly localEntry?: string };
  readonly serviceType?: Service;
}
export type BindingRequirement = KVRequirement | WorkerRequirement<unknown>;
export type Requirements = Readonly<Record<string, BindingRequirement>>;
export interface NativeKV {
  get(key: string, type?: "text"): Promise<string | null>;
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: string, type: "stream"): Promise<ReadableStream | null>;
  getWithMetadata<T = string, M = unknown>(
    key: string,
    options?: { type?: "text" | "json"; cacheTtl?: number },
  ): Promise<{ value: T | null; metadata: M | null; cacheStatus?: string | null }>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list<M = unknown>(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: { name: string; expiration?: number; metadata?: M }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}
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
          : {
              native,
              call: <A>(operation: (service: unknown) => Promise<A>) =>
                call(name, "rpc", () => operation(native)),
            },
      ];
    }),
  ) as Resolved<R>;
export const workerReference = <Service = { fetch(request: Request): Promise<Response> }>(
  id: string,
  options: { readonly entrypoint?: string } = {},
): WorkerRequirement<Service> => ({ type: "cloudflare.worker-reference", id, ...options });
export const externalWorker = <Service = { fetch(request: Request): Promise<Response> }>(
  name: string,
  options: { readonly entrypoint?: string; readonly localEntry?: string } = {},
): WorkerRequirement<Service> => ({
  type: "cloudflare.worker-reference",
  id: name,
  ...(options.entrypoint ? { entrypoint: options.entrypoint } : {}),
  external: { name, ...(options.localEntry ? { localEntry: options.localEntry } : {}) },
});
