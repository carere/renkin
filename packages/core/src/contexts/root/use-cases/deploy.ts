import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { defineStack, type Stack, validateName } from "../models/stack.ts";
import {
  type Change,
  type EnvironmentState,
  emptyState,
  type PendingOperation,
} from "../models/state.ts";
import type { ResourceService, ResourceServices } from "../services/resource/resource-service.ts";
import type { StateLease, StateRepository } from "../services/state/state-repository.ts";
import { assertProtection, plan } from "./plan.ts";
import { renamedState } from "./rename.ts";

export interface DeployOptions {
  readonly environment: string;
  readonly state: StateRepository;
  readonly services: ResourceServices;
  readonly yes?: boolean;
  readonly force?: boolean;
  readonly confirm?: (changes: readonly Change[]) => Promise<boolean>;
  readonly progress?: (change: { readonly id: string; readonly kind: string }) => void;
}

export class DeploymentError extends Error {
  readonly name = "DeploymentError";
}

const serviceFor = (
  operation: PendingOperation,
  services: Readonly<Record<string, ResourceService>>,
): ResourceService => {
  const type = operation.change.desired?.type ?? operation.change.previous?.definition.type;
  const service = type ? services[type] : undefined;
  if (!service) throw new Error(`No adapter registered for resource type ${type}.`);
  return service;
};

const applyPending = async (
  op: PendingOperation,
  service: ResourceService,
  state: EnvironmentState,
  lease: StateLease,
): Promise<PendingOperation> => {
  if (!op.change.desired) throw new Error("Pending apply lacks a resource definition.");
  const outputs = await service.apply(
    op.change.desired,
    op.physicalId,
    op.change.previous,
    state.resources,
  );
  const physicalId =
    service.resolvePhysicalId?.(op.change.desired, op.physicalId, outputs) ?? op.physicalId;
  if (!physicalId) throw new Error("Provider did not return a resource identity.");
  op = {
    ...op,
    physicalId,
    phase: "bindings",
    applied: {
      definition: op.change.desired,
      physicalId,
      outputs,
      ownershipId:
        op.change.previous?.ownershipId ?? op.change.previous?.definition.id ?? op.change.id,
    },
  };
  state.pending = op;
  await lease.write(state);
  return op;
};

const resume = async (
  state: EnvironmentState,
  lease: StateLease,
  services: Readonly<Record<string, ResourceService>>,
  defer = true,
  stack?: Stack,
): Promise<void> => {
  let op = state.pending;
  if (!op) return;
  assertProtection([op.change]);
  const service = serviceFor(op, services);
  if (op.phase === "apply" && op.change.desired) op = await applyPending(op, service, state, lease);
  if (
    op.phase === "remove-previous" &&
    op.change.kind === "replace" &&
    service.deferredBindings &&
    defer
  ) {
    state.bindings = [...(state.bindings ?? []), op];
    delete state.pending;
    await lease.write(state);
    return;
  }
  if (op.phase === "bindings" && op.applied && service.deferredBindings && defer) {
    state.resources[op.change.id] = op.applied;
    state.bindings = [...(state.bindings ?? []), op];
    delete state.pending;
    await lease.write(state);
    return;
  }
  if (op.phase === "bindings" && op.applied) {
    const appliedDefinition = op.applied.definition;
    const desired = stack?.resources.find(
      (resource) =>
        resource.id === appliedDefinition.id &&
        resource.type === appliedDefinition.type &&
        resource.identity === appliedDefinition.identity,
    );
    await service.bind?.(op.applied, { ...state.resources, [op.change.id]: op.applied }, desired, {
      force: op.force ?? false,
    });
    state.resources[op.change.id] = op.applied;
    op = { ...op, phase: "remove-previous" };
    state.pending = op;
    await lease.write(state);
    if (service.deferredBindings && op.change.kind === "replace") {
      state.bindings = [...(state.bindings ?? []), op];
      delete state.pending;
      await lease.write(state);
      return;
    }
  }
  if (
    (op.phase === "remove" || (op.phase === "remove-previous" && op.change.kind === "replace")) &&
    op.change.previous
  ) {
    const oldType = op.change.previous.definition.type;
    const previousService = services[oldType];
    if (!previousService) throw new Error(`No adapter registered for resource type ${oldType}.`);
    if (!op.change.previous.definition.retain)
      await previousService.remove(op.change.previous, state.resources);
  }
  if (op.phase === "remove") delete state.resources[op.change.id];
  delete state.pending;
  await lease.write(state);
};

const applyChange = async (
  change: Change,
  state: EnvironmentState,
  lease: StateLease,
  services: Readonly<Record<string, ResourceService>>,
  stack?: Stack,
  force = false,
): Promise<void> => {
  if (change.kind === "unchanged" && change.desired && change.previous) {
    state.resources[change.id] = { ...change.previous, definition: change.desired };
    return;
  }
  if (change.kind === "retain") {
    delete state.resources[change.id];
    await lease.write(state);
    return;
  }
  state.pending = {
    change,
    force,
    physicalId:
      (change.kind === "update" || change.kind === "remove") && change.previous
        ? change.previous.physicalId
        : `${`${state.stack}-${state.environment}-${change.id}`.toLowerCase().slice(0, 46)}-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    phase: change.kind === "remove" ? "remove" : "apply",
  };
  await lease.write(state);
  await resume(state, lease, services, true, stack);
};

const validateDeployment = async (
  stack: Stack,
  state: EnvironmentState,
  services: Readonly<Record<string, ResourceService>>,
  options: DeployOptions,
): Promise<void> => {
  // Validate the entire requested plan before resuming any old provider operation.
  const projected = structuredClone(state);
  if (state.pending?.change.desired) {
    projected.resources[state.pending.change.id] = state.pending.applied ?? {
      definition: state.pending.change.desired,
      physicalId: state.pending.physicalId,
      outputs: null,
    };
  }
  const changes = plan(stack, projected, options.force);
  assertProtection(
    (state.bindings ?? []).map((op) => {
      const desired = stack.resources.find((resource) => resource.id === op.change.id);
      return { ...op.change, ...(desired ? { desired } : {}) };
    }),
  );
  for (const resource of [
    ...stack.resources,
    ...Object.values(state.resources).map((item) => item.definition),
    ...(state.pending?.change.desired ? [state.pending.change.desired] : []),
    ...(state.pending?.change.previous ? [state.pending.change.previous.definition] : []),
  ]) {
    if (!services[resource.type])
      throw new DeploymentError(`No adapter registered for ${resource.type}.`);
  }
  if (state.pending) {
    const current = stack.resources.find((resource) => resource.id === state.pending?.change.id);
    assertProtection([{ ...state.pending.change, ...(current ? { desired: current } : {}) }]);
  }
  const actionable = [
    ...(state.pending ? [state.pending.change] : []),
    ...changes.filter(
      (change) =>
        change.kind !== "unchanged" || (change.desired && services[change.desired.type]?.refresh),
    ),
  ];
  if (state.pending)
    options.progress?.({
      id: state.pending.change.id,
      kind: `resume ${state.pending.change.kind}`,
    });
  for (const change of changes) options.progress?.({ id: change.id, kind: change.kind });
  if (
    (actionable.length || state.pending) &&
    !options.yes &&
    !(await options.confirm?.(actionable))
  ) {
    throw new DeploymentError("Deployment requires confirmation; use --yes in automation.");
  }
};

const execute = async (stack: Stack, options: DeployOptions): Promise<EnvironmentState> => {
  defineStack(stack);
  validateName(options.environment);
  const lease = await options.state.acquire(stack.name, options.environment);
  try {
    let state = (await lease.read()) ?? emptyState(stack.name, options.environment);
    const services = options.services(lease);
    await validateDeployment(stack, state, services, options);
    if (stack.renames?.length) {
      state = renamedState(stack, state);
      await lease.write(state);
    }
    await resume(state, lease, services, true, stack);
    // Finish a prior graph before beginning another change to its resources.
    const finishBindings = async () => {
      while (state.bindings?.length) {
        const [operation, ...remaining] = state.bindings;
        if (!operation) break;
        state.pending = operation;
        state.bindings = remaining;
        await lease.write(state);
        await resume(state, lease, services, false, stack);
      }
      delete state.bindings;
    };
    for (const original of plan(stack, state, options.force)) {
      // Complete a durable binding graph before removing any of its targets.
      if (original.kind === "remove" || original.kind === "retain") continue;
      if (state.bindings?.some((operation) => operation.change.id === original.id)) continue;
      const service = original.desired ? services[original.desired.type] : undefined;
      const change =
        original.kind === "unchanged" && service?.refresh
          ? { ...original, kind: "update" as const }
          : original;
      await applyChange(change, state, lease, services, stack, options.force);
    }
    await finishBindings();
    // A recovered binding may describe the previous source. Apply the current
    // declarations after that durable graph has completed, never silently skip it.
    for (const change of plan(stack, state).filter((item) => item.kind !== "unchanged")) {
      await applyChange(change, state, lease, services, stack);
    }
    await finishBindings();
    Object.keys(state.outputs).forEach((key) => {
      delete state.outputs[key];
    });
    Object.assign(
      state.outputs,
      Object.fromEntries(
        Object.entries(state.resources).map(([id, resource]) => [
          id,
          { value: resource.outputs, secret: resource.definition.secretOutputs ?? false },
        ]),
      ),
      stack.outputs ?? {},
    );
    await lease.write(state);
    return state;
  } finally {
    await lease.release();
  }
};

export const deploy = (
  stack: Stack,
  options: DeployOptions,
): Effect.Effect<EnvironmentState, DeploymentError> =>
  Effect.uninterruptible(
    Effect.tryPromise({
      try: () => execute(stack, options),
      catch: (error) =>
        error instanceof DeploymentError
          ? error
          : new DeploymentError(
              error instanceof Error &&
                (error.name === "StateError" || error.message.startsWith("Deletion protection"))
                ? error.message
                : "Deployment failed. Ownership and operation progress were preserved; retry to recover.",
            ),
    }),
  );
