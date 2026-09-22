import { Effect } from "effect";

/** Preview authentication can succeed before a newly enabled workers.dev route is available. */
export const waitForStateEndpoint = (
  input: { readonly endpoint: string; readonly stateAuthToken: string; readonly accountId: string },
  timeoutMs = 30_000,
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = yield* Effect.tryPromise((signal) =>
        fetch(`${input.endpoint}/v1/identity`, {
          method: "POST",
          headers: { authorization: `Bearer ${input.stateAuthToken}` },
          redirect: "error",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now()))),
          ]),
        }),
      );
      if (response.status === 404) {
        yield* Effect.tryPromise(async () => {
          await response.body?.cancel();
        });
        const remaining = deadline - Date.now();
        if (remaining > 0) yield* Effect.sleep(Math.min(500, remaining));
        if (remaining <= 500) break;
        continue;
      }
      if (!response.ok)
        return yield* Effect.fail(new Error("State endpoint readiness was rejected."));
      const identity: unknown = yield* Effect.tryPromise(() => response.json());
      if (
        !identity ||
        typeof identity !== "object" ||
        !("protocol" in identity) ||
        identity.protocol !== 1 ||
        !("accountId" in identity) ||
        identity.accountId !== input.accountId
      )
        return yield* Effect.fail(new Error("State endpoint identity does not match the account."));
      return;
    }
    return yield* Effect.fail(
      new Error("State endpoint routing did not become ready before the deadline."),
    );
  });
