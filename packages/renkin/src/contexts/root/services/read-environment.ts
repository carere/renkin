import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import { listEnvironments as list, readOutputs as read } from "@renkin/core/use-cases/outputs";
import { Effect } from "effect";
import { type CloudflareOptions, readCloudState } from "./cloud-environment.ts";

export interface ReadOptions {
  readonly cloudflare?: CloudflareOptions;
  readonly localDirectory?: string;
}

const repository = (options: ReadOptions) =>
  Effect.gen(function* () {
    if (options.localDirectory) return new FileStateRepository(options.localDirectory);
    return yield* readCloudState(options.cloudflare);
  }).pipe(
    Effect.mapError(
      () =>
        new Error("Environment state is unavailable. Check account credentials and state service."),
    ),
    Effect.catchDefect(() =>
      Effect.fail(
        new Error("Environment state is unavailable. Check account credentials and state service."),
      ),
    ),
  );

export const listEnvironments = (stack: string, options: ReadOptions = {}) =>
  Effect.gen(function* () {
    const state = yield* repository(options);
    return state ? yield* list(state, stack) : [];
  });

export const readOutputs = (
  stack: string,
  environment: string,
  options: ReadOptions & { readonly revealSecrets?: boolean } = {},
) =>
  Effect.gen(function* () {
    const state = yield* repository(options);
    return state ? yield* read(state, stack, environment, options) : undefined;
  });
