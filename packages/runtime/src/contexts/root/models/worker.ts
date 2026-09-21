import { Effect, type Layer } from "effect";
import { type Requirements, type Resolved, resolveBindings } from "./binding.ts";

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface WorkerHandlers<Environment, Error, Requirements> {
  readonly fetch: (
    request: Request,
    env: Environment,
    context: WorkerExecutionContext,
  ) => Response | Promise<Response> | Effect.Effect<Response, Error, Requirements>;
}

export interface WorkerImplementation<Environment> {
  readonly __renkinRequirements?: Requirements;
  fetch(request: Request, env: Environment, context: WorkerExecutionContext): Promise<Response>;
}

export function defineWorker<R extends Requirements, Error = never>(
  requirements: R,
  factory: (bindings: Resolved<R>) => WorkerHandlers<Record<string, unknown>, Error, never>,
): WorkerImplementation<Record<string, unknown>>;
export function defineWorker<R extends Requirements, Error, Needs, LayerError>(
  requirements: R,
  factory: (bindings: Resolved<R>) => WorkerHandlers<Record<string, unknown>, Error, Needs>,
  layer: Layer.Layer<Needs, LayerError>,
): WorkerImplementation<Record<string, unknown>>;
export function defineWorker<Environment = Record<string, unknown>, Error = never>(
  handlers: WorkerHandlers<Environment, Error, never>,
): WorkerImplementation<Environment>;
export function defineWorker<Environment, Error, Requirements, LayerError>(
  handlers: WorkerHandlers<Environment, Error, Requirements>,
  layer: Layer.Layer<Requirements, LayerError>,
): WorkerImplementation<Environment>;
export function defineWorker(
  first: Requirements | WorkerHandlers<unknown, unknown, unknown>,
  second?:
    | Layer.Layer<unknown, unknown>
    | ((
        bindings: Resolved<Requirements>,
      ) => WorkerHandlers<Record<string, unknown>, unknown, unknown>),
  third?: Layer.Layer<unknown, unknown>,
): WorkerImplementation<unknown> {
  const requirements = typeof second === "function" ? (first as Requirements) : undefined;
  const layer = typeof second === "function" ? third : second;
  const handlers = new WeakMap<object, WorkerHandlers<unknown, unknown, unknown>>();
  return {
    ...(requirements ? { __renkinRequirements: requirements } : {}),
    async fetch(request, env, context) {
      let selected: WorkerHandlers<unknown, unknown, unknown>;
      if (requirements && typeof second === "function" && env && typeof env === "object") {
        const cached = handlers.get(env);
        selected =
          cached ??
          (second(resolveBindings(requirements, env as Record<string, unknown>)) as WorkerHandlers<
            unknown,
            unknown,
            unknown
          >);
        if (!cached) handlers.set(env, selected);
      } else selected = first as WorkerHandlers<unknown, unknown, unknown>;
      const result = selected.fetch(request, env, context);
      if (!Effect.isEffect(result)) return result;
      return layer
        ? Effect.runPromise(Effect.provide(result, layer) as Effect.Effect<Response, unknown>)
        : Effect.runPromise(result as Effect.Effect<Response, unknown>);
    },
  };
}
