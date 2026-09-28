import { Effect } from "effect";

export class ReleaseError extends Error {
  readonly _tag = "ReleaseError";
}

/** Adapt native asynchronous APIs at the release tooling boundary. */
export const releaseAttempt = <A>(operation: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new ReleaseError(cause instanceof Error ? cause.message : String(cause), { cause }),
  });
