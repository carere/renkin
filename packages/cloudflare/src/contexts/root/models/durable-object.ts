import type { ResourceDefinition } from "@renkin/core/models/stack";
import type {
  DurableObjectInstance,
  DurableObjectRequirement,
} from "@renkin/runtime/models/durable-object";

export interface DurableObjectOptions {
  readonly worker: string;
  readonly className: string;
  /** Rename an owned class without replacing its namespace. Keep this migration declaration. */
  readonly renamedFrom?: string;
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  readonly identity?: string;
}
export interface DurableObjectResource<
  Service extends DurableObjectInstance | undefined = undefined,
> extends ResourceDefinition,
    DurableObjectRequirement<Service> {
  readonly type: "cloudflare.durable-object";
}
export const durableObject = <Service extends DurableObjectInstance | undefined = undefined>(
  id: string,
  options: DurableObjectOptions,
): DurableObjectResource<Service> => ({
  id,
  type: "cloudflare.durable-object",
  identity:
    options.identity ??
    `durable-object:${options.worker}:${options.renamedFrom ?? options.className}`,
  properties: {
    worker: options.worker,
    className: options.className,
    renamedFrom: options.renamedFrom ?? null,
  },
  dependencies: [options.worker],
  protection: { data: true, allowDelete: options.allowDelete ?? false },
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
