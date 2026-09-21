import type { Json, ResourceDefinition } from "#src/contexts/root/models/stack.ts";
import type { ResourceState } from "#src/contexts/root/models/state.ts";
import type { StateLease } from "#src/contexts/root/services/state/state-repository.ts";

// biome-ignore lint/suspicious/noConfusingVoidType: Preserve existing Promise<void> adapters while accepting full observed outputs.
type BindingOutputs = Json | void;

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
  /** Complete binding after provisioning; returned full outputs replace apply outputs atomically. */
  readonly deferredBindings?: boolean;
  /** Observe/reconcile even when desired properties are unchanged. */
  readonly refresh?: boolean;
  bind?(
    resource: ResourceState,
    resources: Readonly<Record<string, ResourceState>>,
    /** Current configuration, only when logical ID, type and physical identity still agree. */
    currentDesired?: ResourceDefinition,
    options?: { readonly force?: boolean },
  ): Promise<BindingOutputs>;
  remove(
    resource: ResourceState,
    resources?: Readonly<Record<string, ResourceState>>,
    /** Explicit retry configuration, validated to preserve logical ID, type and physical identity. */
    currentDesired?: ResourceDefinition,
  ): Promise<void>;
}

export type ResourceServices = (lease: StateLease) => Readonly<Record<string, ResourceService>>;
