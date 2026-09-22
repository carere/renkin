import type { Effect } from "effect";
import type { Json, ResourceDefinition } from "#src/contexts/root/models/stack.ts";
import type { ResourceState } from "#src/contexts/root/models/state.ts";
import type { StateLease } from "#src/contexts/root/services/state/state-repository.ts";

// biome-ignore lint/suspicious/noConfusingVoidType: Binding adapters may return observed outputs or no update.
type BindingOutputs = Json | void;

/** Operations must be idempotent for a preallocated physical ID, including after lost responses. */
export interface ResourceService {
  apply(
    definition: ResourceDefinition,
    physicalId: string,
    previous?: ResourceState,
    resources?: Readonly<Record<string, ResourceState>>,
  ): Effect.Effect<Json, Error>;
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
  ): Effect.Effect<BindingOutputs, Error>;
  remove(
    resource: ResourceState,
    resources?: Readonly<Record<string, ResourceState>>,
    /** Explicit retry configuration, validated to preserve logical ID, type and physical identity. */
    currentDesired?: ResourceDefinition,
  ): Effect.Effect<void, Error>;
}

export type ResourceServices = (lease: StateLease) => Readonly<Record<string, ResourceService>>;
