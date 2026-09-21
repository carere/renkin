import { DurableObject } from "cloudflare:workers";
import type { CloudflareWorkersModule, DurableObjectState } from "@cloudflare/workers-types";
import { type Requirements, resolveBindings } from "./binding.ts";

const NativeDurableObject: typeof CloudflareWorkersModule.DurableObject = DurableObject;
export class DurableObjectImplementation<R extends Requirements> extends NativeDurableObject<
  Record<string, unknown>
> {
  protected readonly requirements: R = {} as R;
  protected get bindings() {
    return resolveBindings(this.requirements, this.env);
  }
}

export interface DurableObjectConstructor<R extends Requirements> {
  new (ctx: DurableObjectState, env: Record<string, unknown>): DurableObjectImplementation<R>;
}

/** Extend this native class with ordinary RPC, fetch, alarm and storage methods. */
export const defineDurableObject = <R extends Requirements>(
  requirements: R,
): DurableObjectConstructor<R> =>
  class extends DurableObjectImplementation<R> {
    static readonly __renkinRequirements = requirements;
    protected readonly requirements = requirements;
  };
