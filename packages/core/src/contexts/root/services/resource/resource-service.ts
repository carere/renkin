import type { Json, ResourceDefinition } from "../../models/stack.ts";
import type { ResourceState } from "../../models/state.ts";
import type { StateLease } from "../state/state-repository.ts";

/** Operations must be idempotent for a preallocated physical ID, including after lost responses. */
export interface ResourceService {
  apply(
    definition: ResourceDefinition,
    physicalId: string,
    previous?: ResourceState,
  ): Promise<Json>;
  bind?(resource: ResourceState, resources: Readonly<Record<string, ResourceState>>): Promise<void>;
  remove(resource: ResourceState): Promise<void>;
}

export type ResourceServices = (lease: StateLease) => Readonly<Record<string, ResourceService>>;
