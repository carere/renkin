import type { ResourceDefinition, Stack } from "@renkin/core/models/stack";

/** Authoring recipes and framework hooks are process-local, never durable state. */
const definition = (resource: ResourceDefinition): ResourceDefinition => ({
  id: resource.id,
  type: resource.type,
  identity: resource.identity,
  properties: resource.properties,
  ...(resource.dependencies ? { dependencies: resource.dependencies } : {}),
  ...(resource.references ? { references: resource.references } : {}),
  ...(resource.protection ? { protection: resource.protection } : {}),
  ...(resource.retain === undefined ? {} : { retain: resource.retain }),
  ...(resource.secretOutputs === undefined ? {} : { secretOutputs: resource.secretOutputs }),
});

/** Keep executable prepared options for development; pass only the core contract to deployment. */
export const stackDefinition = (stack: Stack): Stack => ({
  name: stack.name,
  resources: stack.resources.map(definition),
  ...(stack.outputs ? { outputs: stack.outputs } : {}),
  ...(stack.renames ? { renames: stack.renames } : {}),
});
