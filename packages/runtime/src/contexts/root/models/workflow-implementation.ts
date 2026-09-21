import { WorkflowEntrypoint } from "cloudflare:workers";
import type { CloudflareWorkersModule } from "@cloudflare/workers-types";
import { Cause, Effect, Exit, type Layer } from "effect";
import { type Requirements, type Resolved, resolveBindings } from "./binding.ts";
import { type WorkflowSteps, WorkflowTaskError, workflowSteps } from "./workflow-steps.ts";
export type WorkflowEvent<Params> = CloudflareWorkersModule.WorkflowEvent<Params>;
type WorkflowStep = CloudflareWorkersModule.WorkflowStep;

type Run<R extends Requirements, Params, A, E, Needs> = (
  event: WorkflowEvent<Params>,
  steps: WorkflowSteps,
  bindings: Resolved<R>,
) => A | Promise<A> | Effect.Effect<A, E, Needs>;

export function defineWorkflow<R extends Requirements, Params, A, E>(
  requirements: R,
  run: Run<R, Params, A, E, never>,
): typeof CloudflareWorkersModule.WorkflowEntrypoint<Record<string, unknown>, Params>;
export function defineWorkflow<R extends Requirements, Params, A, E, Needs, LayerError>(
  requirements: R,
  run: Run<R, Params, A, E, Needs>,
  layer: Layer.Layer<Needs, LayerError>,
): typeof CloudflareWorkersModule.WorkflowEntrypoint<Record<string, unknown>, Params>;
export function defineWorkflow<R extends Requirements, Params>(
  requirements: R,
  run: Run<R, Params, unknown, unknown, unknown>,
  layer?: Layer.Layer<unknown, unknown>,
): typeof CloudflareWorkersModule.WorkflowEntrypoint<Record<string, unknown>, Params> {
  return class extends WorkflowEntrypoint<Record<string, unknown>, Params> {
    static readonly __renkinRequirements = requirements;
    async run(event: WorkflowEvent<Params>, native: WorkflowStep): Promise<unknown> {
      const result = run(event, workflowSteps(native), resolveBindings(requirements, this.env));
      if (!Effect.isEffect(result)) return result;
      const exit = await Effect.runPromiseExit(
        layer
          ? (Effect.provide(result, layer) as Effect.Effect<unknown, unknown>)
          : (result as Effect.Effect<unknown, unknown>),
      );
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        // Native pause/terminate signals must reach the Workflow engine unchanged.
        throw error instanceof WorkflowTaskError ? error.cause : error;
      }
      return exit.value;
    }
  };
}
