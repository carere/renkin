import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import { defineStack, type Stack, validateName } from "@renkin/core/models/stack";
import { emptyState } from "@renkin/core/models/state";
import {
  DeploymentError,
  type DeployOptions,
  deploy as reconcile,
} from "@renkin/core/use-cases/deploy";
import { plan as resourcePlan } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
import {
  type CloudflareOptions,
  cloudEnvironment,
  readCloudState,
} from "#src/contexts/root/services/cloud-environment.ts";
import { stackDefinition } from "./stack-definition.ts";

export interface DeploymentOptions
  extends Pick<DeployOptions, "environment" | "yes" | "force" | "confirm" | "progress"> {
  readonly cloudflare?: CloudflareOptions;
}

const apply = (stack: Stack, options: DeploymentOptions, removeEmpty = false) =>
  Effect.gen(function* () {
    const prepared = yield* prepareStack(stack).pipe(
      Effect.map(stackDefinition),
      Effect.mapError(() => new DeploymentError("Worker build failed.")),
      Effect.catchDefect(() => Effect.fail(new DeploymentError("Worker build failed."))),
    );
    const environment = yield* cloudEnvironment(
      stack.name,
      options.environment,
      options.cloudflare,
      prepared.resources,
    ).pipe(
      Effect.mapError(
        () =>
          new DeploymentError(
            "Cloud state initialization failed. Check account ID, token permissions and the state Worker.",
          ),
      ),
      Effect.catchDefect(() =>
        Effect.fail(
          new DeploymentError(
            "Cloud state initialization failed. Check account ID, token permissions and the state Worker.",
          ),
        ),
      ),
    );
    return yield* reconcile(prepared, { ...options, ...environment, removeEmpty });
  });

export const deploy = (stack: Stack, options: DeploymentOptions) => apply(stack, options);

/** Removal uses persisted ownership; it does not evaluate infrastructure declarations. */
export const removeEnvironment = (stack: string, options: DeploymentOptions) =>
  apply({ name: stack, resources: [] }, options, true);

/** A read-only preview. Deployment plans again under its exclusive environment lock. */
export const planDeployment = (
  stack: Stack,
  options: Pick<DeploymentOptions, "environment" | "force" | "cloudflare">,
) =>
  Effect.gen(function* () {
    defineStack(stack);
    validateName(options.environment);
    const prepared = stackDefinition(yield* prepareStack(stack));
    const repository = yield* readCloudState(options.cloudflare);
    const current =
      (repository ? yield* repository.read(stack.name, options.environment) : undefined) ??
      emptyState(stack.name, options.environment);
    return resourcePlan(prepared, current, options.force).map(({ id, kind }) => ({ id, kind }));
  }).pipe(
    Effect.mapError(
      () =>
        new DeploymentError(
          "Plan could not be read. Check configuration, state access and deletion protection.",
        ),
    ),
    Effect.catchDefect(() =>
      Effect.fail(
        new DeploymentError(
          "Plan could not be read. Check configuration, state access and deletion protection.",
        ),
      ),
    ),
  );
