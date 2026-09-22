import type { LocalWorker } from "@renkin/runtime/services/local/local-worker-service";
import { Effect } from "effect";

/** Dispatches workerd's scheduled event, including the native controller and execution context. */
export const scheduled = (
  worker: LocalWorker,
  options: { readonly cron: string; readonly scheduledTime?: Date },
) =>
  Effect.tryPromise({
    try: () => worker.scheduled(options),
    catch: () => new Error("Local scheduled event failed."),
  });

/** Complete RFC 822 messages captured by the native local email binding. Read before closing the session. */
export const capturedEmails = (session: { capturedEmails(): Promise<readonly string[]> }) =>
  Effect.tryPromise({
    try: () => session.capturedEmails(),
    catch: () => new Error("Local email captures could not be read."),
  });
