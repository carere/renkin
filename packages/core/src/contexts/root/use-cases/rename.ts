import type { ResourceDefinition, Stack } from "#src/contexts/root/models/stack.ts";
import type { EnvironmentState } from "#src/contexts/root/models/state.ts";

/** Validate every move before changing a clone; committing the clone is one state transaction. */
export const renamedState = (stack: Stack, state: EnvironmentState): EnvironmentState => {
  const moves = stack.renames ?? [];
  const result = structuredClone(state);
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const { from, to } of moves) {
    if (from === to || sources.has(from) || targets.has(to))
      throw new Error("Rename sources and targets must be distinct and unique.");
    sources.add(from);
    targets.add(to);
    const desired = stack.resources.find((resource) => resource.id === to);
    if (!desired || stack.resources.some((resource) => resource.id === from))
      throw new Error("A rename requires the new declaration and must remove the old declaration.");
    const previous = state.resources[from];
    if (!previous) {
      // A committed move remains valid on retry; no inferred move is performed.
      if (!state.resources[to] || state.resources[to]?.definition.type !== desired.type)
        throw new Error("Rename source is not owned by this environment.");
      continue;
    }
    if (state.resources[to]) throw new Error("Rename target is already owned.");
    if (previous.definition.type !== desired.type)
      throw new Error("A rename cannot change the resource type.");
    if (previous.definition.identity !== desired.identity)
      throw new Error("A rename cannot change the physical resource identity.");
  }
  for (const source of sources)
    if (targets.has(source)) throw new Error("Chained and cyclic renames are not supported.");
  if (moves.some(({ from }) => state.resources[from]) && (state.pending || state.bindings?.length))
    throw new Error("Finish the interrupted deployment before renaming resources.");
  const remap = (id: string) => moves.find((move) => move.from === id)?.to ?? id;
  const rewrite = (definition: ResourceDefinition): ResourceDefinition => ({
    ...definition,
    id: remap(definition.id),
    ...(definition.dependencies ? { dependencies: definition.dependencies.map(remap) } : {}),
    ...(definition.references ? { references: definition.references.map(remap) } : {}),
  });
  for (const { from, to } of moves) {
    const resource = result.resources[from];
    if (!resource) continue;
    result.resources[to] = {
      ...resource,
      definition: rewrite(resource.definition),
      ownershipId: resource.ownershipId ?? from,
    };
    delete result.resources[from];
    if (Object.hasOwn(result.outputs, from)) {
      const output = result.outputs[from];
      if (output) result.outputs[to] = output;
      delete result.outputs[from];
    }
  }
  for (const [id, resource] of Object.entries(result.resources))
    result.resources[id] = { ...resource, definition: rewrite(resource.definition) };
  return result;
};
