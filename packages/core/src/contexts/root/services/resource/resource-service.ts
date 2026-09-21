import type { Json, ResourceDefinition } from "../../models/stack.ts";
import type { ResourceState } from "../../models/state.ts";
import type { StateLease } from "../state/state-repository.ts";

/** Operations must be idempotent for a preallocated physical ID, including after lost responses. */
export interface ResourceService {
  apply(
    definition: ResourceDefinition,
    physicalId: string,
    previous?: ResourceState,
    resources?: Readonly<Record<string, ResourceState>>,
  ): Promise<Json>;
  /** Extract a server-assigned provider ID from an observed create result. */
  resolvePhysicalId?(definition: ResourceDefinition, allocationId: string, outputs: Json): string;
  /** Complete binding after every resource has been provisioned. */
  readonly deferredBindings?: boolean;
  /** Observe/reconcile even when desired properties are unchanged. */
  readonly refresh?: boolean;
  bind?(
    resource: ResourceState,
    resources: Readonly<Record<string, ResourceState>>,
    /** Current configuration, only when logical ID, type and physical identity still agree. */
    currentDesired?: ResourceDefinition,
    options?: { readonly force?: boolean },
  ): Promise<void>;
  remove(
    resource: ResourceState,
    resources?: Readonly<Record<string, ResourceState>>,
    /** Explicit retry configuration, validated to preserve logical ID, type and physical identity. */
    currentDesired?: ResourceDefinition,
  ): Promise<void>;
}

export type ResourceServices = (lease: StateLease) => Readonly<Record<string, ResourceService>>;
