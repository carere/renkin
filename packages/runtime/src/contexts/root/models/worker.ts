import { Effect, type Layer } from "effect";

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
  fetch(request: Request, env: Environment, context: WorkerExecutionContext): Promise<Response>;
}

export function defineWorker<Environment = Record<string, unknown>, Error = never>(
  handlers: WorkerHandlers<Environment, Error, never>,
): WorkerImplementation<Environment>;
export function defineWorker<Environment, Error, Requirements, LayerError>(
  handlers: WorkerHandlers<Environment, Error, Requirements>,
  layer: Layer.Layer<Requirements, LayerError>,
): WorkerImplementation<Environment>;
export function defineWorker<Environment, Error, Requirements, LayerError>(
  handlers: WorkerHandlers<Environment, Error, Requirements>,
  layer?: Layer.Layer<Requirements, LayerError>,
): WorkerImplementation<Environment> {
  return {
    async fetch(request, env, context) {
      const result = handlers.fetch(request, env, context);
      if (!Effect.isEffect(result)) return result;
      // The overload without a layer accepts only effects with no requirements.
      return layer
        ? Effect.runPromise(Effect.provide(result, layer))
        : Effect.runPromise(result as Effect.Effect<Response, Error>);
    },
  };
}
