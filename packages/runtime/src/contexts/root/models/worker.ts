import type { MessageBatch, ScheduledController } from "@cloudflare/workers-types";
import { Effect, type Layer } from "effect";
import { type Requirements, type Resolved, resolveBindings } from "./binding.ts";

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type HandlerResult<A, Error, Needs> = A | Promise<A> | Effect.Effect<A, Error, Needs>;
export interface WorkerHandlers<Environment, Error, Needs, Body = unknown> {
  readonly fetch?: (
    request: Request,
    env: Environment,
    context: WorkerExecutionContext,
  ) => HandlerResult<Response, Error, Needs>;
  readonly scheduled?: (
    controller: ScheduledController,
    env: Environment,
    context: WorkerExecutionContext,
  ) => HandlerResult<void, Error, Needs>;
  readonly queue?: (
    batch: MessageBatch<Body>,
    env: Environment,
    context: WorkerExecutionContext,
  ) => HandlerResult<void, Error, Needs>;
}

export interface WorkerImplementation<Environment, Body = unknown> {
  readonly __renkinRequirements?: Requirements;
  fetch(request: Request, env: Environment, context: WorkerExecutionContext): Promise<Response>;
  scheduled(
    controller: ScheduledController,
    env: Environment,
    context: WorkerExecutionContext,
  ): Promise<void>;
  queue(
    batch: MessageBatch<Body>,
    env: Environment,
    context: WorkerExecutionContext,
  ): Promise<void>;
}

export function defineWorker<R extends Requirements, Body = unknown>(
  requirements: R,
  factory: (bindings: Resolved<R>) => WorkerHandlers<Record<string, unknown>, unknown, never, Body>,
): WorkerImplementation<Record<string, unknown>, Body>;
export function defineWorker<R extends Requirements, Needs, LayerError, Body = unknown>(
  requirements: R,
  factory: (bindings: Resolved<R>) => WorkerHandlers<Record<string, unknown>, unknown, Needs, Body>,
  layer: Layer.Layer<Needs, LayerError>,
): WorkerImplementation<Record<string, unknown>, Body>;
export function defineWorker<Environment = Record<string, unknown>, Body = unknown>(
  handlers: WorkerHandlers<Environment, unknown, never, Body>,
): WorkerImplementation<Environment, Body>;
export function defineWorker<Environment, Needs, LayerError, Body = unknown>(
  handlers: WorkerHandlers<Environment, unknown, Needs, Body>,
  layer: Layer.Layer<Needs, LayerError>,
): WorkerImplementation<Environment, Body>;
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
  const resolve = (env: unknown) => {
    if (!requirements || typeof second !== "function" || !env || typeof env !== "object")
      return first as WorkerHandlers<unknown, unknown, unknown>;
    const cached = handlers.get(env);
    if (cached) return cached;
    const selected = second(
      resolveBindings(requirements, env as Record<string, unknown>),
    ) as WorkerHandlers<unknown, unknown, unknown>;
    handlers.set(env, selected);
    return selected;
  };
  const run = async <A>(result: HandlerResult<A, unknown, unknown>): Promise<A> => {
    if (!Effect.isEffect(result)) return result;
    return layer
      ? Effect.runPromise(Effect.provide(result, layer) as Effect.Effect<A, unknown>)
      : Effect.runPromise(result as Effect.Effect<A, unknown>);
  };
  return {
    ...(requirements ? { __renkinRequirements: requirements } : {}),
    fetch: (request, env, context) =>
      run(
        resolve(env).fetch?.(request, env, context) ?? new Response("Not Found", { status: 404 }),
      ),
    scheduled: (controller, env, context) => {
      const handler = resolve(env).scheduled;
      if (!handler) return Promise.reject(new Error("Worker has no scheduled handler."));
      return run(handler(controller, env, context));
    },
    queue: (batch, env, context) => {
      const handler = resolve(env).queue;
      if (!handler) return Promise.reject(new Error("Worker has no queue handler."));
      return run(handler(batch, env, context));
    },
  };
}
