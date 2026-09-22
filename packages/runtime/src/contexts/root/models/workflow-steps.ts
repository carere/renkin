import type { CloudflareWorkersModule, Rpc } from "@cloudflare/workers-types";
import { Cause, type Context, Effect, Exit } from "effect";

type WorkflowStep = CloudflareWorkersModule.WorkflowStep;
type WorkflowStepConfig = CloudflareWorkersModule.WorkflowStepConfig;
export type WorkflowStepContext = CloudflareWorkersModule.WorkflowStepContext;

const runTask = async <A, E, R>(effect: Effect.Effect<A, E, R>, services: Context.Context<R>) => {
  const result = await Effect.runPromiseExit(Effect.provide(effect, services));
  if (Exit.isFailure(result)) throw Cause.squash(result.cause);
  return result.value;
};
export class WorkflowTaskError extends Error {
  readonly name = "WorkflowTaskError";
  constructor(
    readonly step: string,
    readonly cause: unknown,
  ) {
    super(`Workflow step ${step} failed.`);
  }
}
export const workflowSteps = (native: WorkflowStep) => ({
  native,
  task: <A extends Rpc.Serializable<A>, E, R>(
    name: string,
    run: (context: WorkflowStepContext) => Effect.Effect<A, E, R>,
    options: WorkflowStepConfig = {},
  ) =>
    Effect.gen(function* () {
      const services = yield* Effect.context<R>();
      return yield* Effect.tryPromise({
        try: () => native.do(name, options, (context) => runTask(run(context), services)),
        catch: (cause) => new WorkflowTaskError(name, cause),
      });
    }),
  sleep: (name: string, duration: Parameters<WorkflowStep["sleep"]>[1]) =>
    Effect.tryPromise({
      try: () => native.sleep(name, duration),
      catch: (cause) => new WorkflowTaskError(name, cause),
    }),
  sleepUntil: (name: string, timestamp: Date | number) =>
    Effect.tryPromise({
      try: () => native.sleepUntil(name, timestamp),
      catch: (cause) => new WorkflowTaskError(name, cause),
    }),
  waitForEvent: <Payload extends Rpc.Serializable<Payload>>(
    name: string,
    options: Parameters<WorkflowStep["waitForEvent"]>[1],
  ) =>
    Effect.tryPromise({
      try: () => native.waitForEvent<Payload>(name, options),
      catch: (cause) => new WorkflowTaskError(name, cause),
    }),
});
export type WorkflowSteps = ReturnType<typeof workflowSteps>;
