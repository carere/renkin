import type {
  CloudflareWorkersModule,
  DurableObjectNamespace,
  DurableObjectState as NativeState,
  DurableObjectStorage as NativeStorage,
} from "@cloudflare/workers-types";
import { Effect } from "effect";

export type DurableObjectInstance = CloudflareWorkersModule.DurableObject;
export type DurableObjectState = NativeState;
export type DurableObjectStorage = NativeStorage;
export interface DurableObjectRequirement<
  Service extends DurableObjectInstance | undefined = undefined,
> {
  readonly type: "cloudflare.durable-object";
  readonly id: string;
  readonly serviceType?: Service;
}
export class DurableObjectBindingError extends Error {
  readonly name = "DurableObjectBindingError";
  constructor(readonly binding: string) {
    super(`Durable Object binding ${binding} failed.`);
  }
}

/** Native namespaces, IDs, stubs and storage remain workerd objects. */
export const durableObjectClient = <Service extends DurableObjectInstance | undefined>(
  native: DurableObjectNamespace<Service>,
  binding: string,
) => ({
  native,
  call: <A>(operation: (namespace: DurableObjectNamespace<Service>) => Promise<A>) =>
    Effect.tryPromise({
      try: () => operation(native),
      catch: () => new DurableObjectBindingError(binding),
    }),
});
export type DurableObjectClient<Service extends DurableObjectInstance | undefined> = ReturnType<
  typeof durableObjectClient<Service>
>;
