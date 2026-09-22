import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  defineStack,
  type ResourceDefinition,
  type Stack,
  validateName,
} from "#src/contexts/root/models/stack.ts";
import {
  type Change,
  type EnvironmentState,
  emptyState,
  type PendingOperation,
} from "#src/contexts/root/models/state.ts";
import { ResourceOperationError } from "#src/contexts/root/services/resource/resource-operation-error.ts";
import type {
  ResourceService,
  ResourceServices,
} from "#src/contexts/root/services/resource/resource-service.ts";
import type {
  StateLease,
  StateRepository,
} from "#src/contexts/root/services/state/state-repository.ts";
import { assertProtection, plan } from "./plan.ts";
import { renamedState } from "./rename.ts";
export interface DeployOptions {
  /** Used only for explicit removal; record deletion remains fenced by the same lease. */
  readonly removeEmpty?: boolean;
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
const applyPending = (
  op: PendingOperation,
  service: ResourceService,
  state: EnvironmentState,
  lease: StateLease,
) =>
  Effect.gen(function* () {
    if (!op.change.desired)
      return yield* Effect.fail(new Error("Pending apply lacks a resource definition."));
    const outputs = yield* service.apply(
      op.change.desired,
      op.physicalId,
      op.change.previous,
      state.resources,
    );
    const physicalId =
      service.resolvePhysicalId?.(op.change.desired, op.physicalId, outputs) ?? op.physicalId;
    if (!physicalId)
      return yield* Effect.fail(new Error("Provider did not return a resource identity."));
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
    yield* lease.write(state);
    return op;
  });
const currentDefinition = (stack: Stack | undefined, previous: ResourceDefinition) =>
  stack?.resources.find(
    (resource) =>
      resource.id === previous.id &&
      resource.type === previous.type &&
      resource.identity === previous.identity,
  );
const resume = (
  state: EnvironmentState,
  lease: StateLease,
  services: Readonly<Record<string, ResourceService>>,
  defer = true,
  stack?: Stack,
) =>
  Effect.gen(function* () {
    let op = state.pending;
    if (!op) return;
    assertProtection([op.change]);
    const service = serviceFor(op, services);
    if (op.phase === "apply" && op.change.desired)
      op = yield* applyPending(op, service, state, lease);
    if (
      op.phase === "remove-previous" &&
      op.change.kind === "replace" &&
      service.deferredBindings &&
      defer
    ) {
      state.bindings = [...(state.bindings ?? []), op];
      delete state.pending;
      yield* lease.write(state);
      return;
    }
    if (op.phase === "bindings" && op.applied && service.deferredBindings && defer) {
      state.resources[op.change.id] = op.applied;
      state.bindings = [...(state.bindings ?? []), op];
      delete state.pending;
      yield* lease.write(state);
      return;
    }
    if (op.phase === "bindings" && op.applied) {
      const appliedDefinition = op.applied.definition;
      const desired = currentDefinition(stack, appliedDefinition);
      const outputs = yield* service.bind?.(
        op.applied,
        { ...state.resources, [op.change.id]: op.applied },
        desired,
        {
          force: op.force ?? false,
        },
      ) ?? Effect.void;
      const applied = outputs === undefined ? op.applied : { ...op.applied, outputs };
      state.resources[op.change.id] = applied;
      op = { ...op, applied, phase: "remove-previous" };
      state.pending = op;
      yield* lease.write(state);
      if (service.deferredBindings && op.change.kind === "replace") {
        state.bindings = [...(state.bindings ?? []), op];
        delete state.pending;
        yield* lease.write(state);
        return;
      }
    }
    if (
      (op.phase === "remove" || (op.phase === "remove-previous" && op.change.kind === "replace")) &&
      op.change.previous
    ) {
      const oldType = op.change.previous.definition.type;
      const previousService = services[oldType];
      if (!previousService)
        return yield* Effect.fail(new Error(`No adapter registered for resource type ${oldType}.`));
      if (!op.change.previous.definition.retain)
        yield* previousService.remove(
          op.change.previous,
          state.resources,
          currentDefinition(stack, op.change.previous.definition),
        );
    }
    if (op.phase === "remove") delete state.resources[op.change.id];
    delete state.pending;
    yield* lease.write(state);
  });
const applyChange = (
  change: Change,
  state: EnvironmentState,
  lease: StateLease,
  services: Readonly<Record<string, ResourceService>>,
  stack?: Stack,
  force = false,
) =>
  Effect.gen(function* () {
    if (change.kind === "unchanged" && change.desired && change.previous) {
      state.resources[change.id] = { ...change.previous, definition: change.desired };
      return;
    }
    if (change.kind === "retain") {
      delete state.resources[change.id];
      yield* lease.write(state);
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
    yield* lease.write(state);
    yield* resume(state, lease, services, true, stack);
  });
const validateDeployment = (
  stack: Stack,
  state: EnvironmentState,
  services: Readonly<Record<string, ResourceService>>,
  options: DeployOptions,
) =>
  Effect.gen(function* () {
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
        return yield* Effect.fail(
          new DeploymentError(`No adapter registered for ${resource.type}.`),
        );
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
    const confirm = options.confirm;
    if (
      (actionable.length || state.pending) &&
      !options.yes &&
      !(
        confirm &&
        (yield* Effect.tryPromise({
          try: () => confirm(actionable),
          catch: () => new DeploymentError("Deployment confirmation failed."),
        }))
      )
    ) {
      return yield* Effect.fail(
        new DeploymentError("Deployment requires confirmation; use --yes in automation."),
      );
    }
  });
// Finish a prior graph before beginning another change to its resources.
const finishBindings = (
  state: EnvironmentState,
  lease: StateLease,
  services: Readonly<Record<string, ResourceService>>,
  stack: Stack,
) =>
  Effect.gen(function* () {
    while (state.bindings?.length) {
      const [operation, ...remaining] = state.bindings;
      if (!operation) break;
      state.pending = operation;
      state.bindings = remaining;
      yield* lease.write(state);
      yield* resume(state, lease, services, false, stack);
    }
    delete state.bindings;
  });

const execute = (stack: Stack, options: DeployOptions) =>
  Effect.gen(function* () {
    defineStack(stack);
    if (options.removeEmpty && stack.resources.length)
      return yield* Effect.fail(
        new DeploymentError("Environment removal requires an empty desired stack."),
      );
    validateName(options.environment);
    return yield* Effect.acquireUseRelease(
      options.state.acquire(stack.name, options.environment),
      (lease) =>
        Effect.gen(function* () {
          let state = (yield* lease.read()) ?? emptyState(stack.name, options.environment);
          const services = options.services(lease);
          yield* validateDeployment(stack, state, services, options);
          if (stack.renames?.length) {
            state = renamedState(stack, state);
            yield* lease.write(state);
          }
          yield* resume(state, lease, services, true, stack);
          for (const original of plan(stack, state, options.force)) {
            // Complete a durable binding graph before removing any of its targets.
            if (original.kind === "remove" || original.kind === "retain") continue;
            if (state.bindings?.some((operation) => operation.change.id === original.id)) continue;
            const service = original.desired ? services[original.desired.type] : undefined;
            const change =
              original.kind === "unchanged" && service?.refresh
                ? { ...original, kind: "update" as const }
                : original;
            yield* applyChange(change, state, lease, services, stack, options.force);
          }
          yield* finishBindings(state, lease, services, stack);
          // A recovered binding may describe the previous source. Apply the current
          // declarations after that durable graph has completed, never silently skip it.
          for (const change of plan(stack, state).filter((item) => item.kind !== "unchanged")) {
            yield* applyChange(change, state, lease, services, stack);
          }
          yield* finishBindings(state, lease, services, stack);
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
          yield* lease.write(state);
          if (options.removeEmpty) yield* lease.removeEmpty();
          return state;
        }),
      (lease) => lease.release(),
    );
  });
const deploymentError = (error: unknown) =>
  error instanceof DeploymentError
    ? error
    : new DeploymentError(
        error instanceof Error &&
          (error instanceof ResourceOperationError ||
            error.name === "StateError" ||
            error.message.startsWith("Deletion protection"))
          ? error.message
          : "Deployment failed. Ownership and operation progress were preserved; retry to recover.",
      );

/** A mutation and its durable checkpoint finish together, even if the caller is interrupted. */
export const deploy = (
  stack: Stack,
  options: DeployOptions,
): Effect.Effect<EnvironmentState, DeploymentError> =>
  execute(stack, options).pipe(
    Effect.mapError(deploymentError),
    Effect.catchDefect((error) => Effect.fail(deploymentError(error))),
    Effect.uninterruptible,
  );
