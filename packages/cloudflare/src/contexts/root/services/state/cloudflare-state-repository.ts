import { decodeState, type EnvironmentState } from "@renkin/core/models/state";
import {
  StateError,
  type StateLease,
  type StateRepository,
} from "@renkin/core/services/state/state-repository";
import { Effect, Fiber } from "effect";
import {
  type ReconciliationDecision,
  type ReconciliationReceipt,
  type RecoveryInspection,
  validDecision,
  validInspection,
  validReceipt,
} from "./reconciliation.ts";
import type { CoordinatorRequest, GatewayRequest, GatewayResponse } from "./state-protocol.ts";

export interface CloudflareStateOptions {
  readonly endpoint: string;
  readonly apiToken: string;
  readonly stateAuthToken: string;
  readonly fetch?: typeof fetch;
}
/** The same account endpoint works in developer processes and fresh CI without a local key cache. */
export class CloudflareStateRepository implements StateRepository {
  constructor(private readonly options: CloudflareStateOptions) {}
  private call<T>(action: string, body: CoordinatorRequest): Effect.Effect<T, StateError> {
    return Effect.gen({ self: this }, function* () {
      const result = yield* Effect.tryPromise({
        try: (signal) =>
          (this.options.fetch ?? fetch)(
            `${this.options.endpoint.replace(/\/$/, "")}/v1/${action}`,
            {
              method: "POST",
              signal,
              headers: {
                authorization: `Bearer ${this.options.stateAuthToken}`,
                "x-renkin-cloudflare-token": this.options.apiToken,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            },
          ),
        catch: () => new StateError("unreadable", "Cloud state is unavailable."),
      });
      if (!result.ok) {
        if (result.status === 409)
          return yield* Effect.fail(
            new StateError(
              "busy",
              "Environment is busy, the lease expired, or a provider operation needs outcome reconciliation.",
            ),
          );
        if (result.status === 401 || result.status === 403)
          return yield* Effect.fail(
            new StateError("unauthorized", "Cloud state authentication failed."),
          );
        return yield* Effect.fail(
          new StateError(
            "unreadable",
            "Cloud state is unreadable; do not replace it with empty state.",
          ),
        );
      }
      return yield* Effect.tryPromise({
        try: () => result.json() as Promise<T>,
        catch: () => new StateError("invalid", "Cloud state returned an invalid response."),
      });
    });
  }
  inspect(stack: string, environment: string): Effect.Effect<RecoveryInspection, StateError> {
    return this.call<unknown>("inspect", { stack, environment }).pipe(
      Effect.flatMap((value) =>
        validInspection(value)
          ? Effect.succeed(value)
          : Effect.fail(new StateError("invalid", "Recovery inspection is invalid.")),
      ),
    );
  }
  reconcile(
    stack: string,
    environment: string,
    decision: ReconciliationDecision,
  ): Effect.Effect<ReconciliationReceipt, StateError> {
    return Effect.gen({ self: this }, function* () {
      if (!validDecision(decision))
        return yield* Effect.fail(
          new StateError(
            "invalid",
            "Reconciliation requires exact operation identity, outcome, operator, evidence and explicit provider settlement.",
          ),
        );
      const value = yield* this.call<unknown>("reconcile", { stack, environment, decision });
      if (!validReceipt(value))
        return yield* Effect.fail(
          new StateError(
            "invalid",
            "Reconciliation receipt is invalid; inspect the exact operation before retrying.",
          ),
        );
      return value;
    });
  }
  read(
    stack: string,
    environment: string,
  ): Effect.Effect<EnvironmentState | undefined, StateError> {
    return this.call<string | null>("read", { stack, environment }).pipe(
      Effect.flatMap((value) =>
        value === null
          ? Effect.succeed(undefined)
          : Effect.try({
              try: () => decodeState(value, stack, environment),
              catch: () =>
                new StateError(
                  "invalid",
                  "Cloud state is invalid or belongs to another environment.",
                ),
            }),
      ),
    );
  }
  list(stack: string): Effect.Effect<readonly string[], StateError> {
    return this.call<unknown>("list", { stack }).pipe(
      Effect.flatMap((value) =>
        Array.isArray(value) && value.every((item) => typeof item === "string")
          ? Effect.succeed(value as string[])
          : Effect.fail(new StateError("invalid", "Cloud environment index is invalid.")),
      ),
    );
  }
  acquire(stack: string, environment: string): Effect.Effect<StateLease, StateError> {
    return Effect.uninterruptible(
      Effect.gen({ self: this }, function* () {
        const { token } = yield* this.call<{ token: string }>("acquire", { stack, environment });
        if (typeof token !== "string")
          return yield* Effect.fail(new StateError("invalid", "Cloud state lease is invalid."));
        let failure: StateError | undefined;
        let ended = false;
        const renewal = yield* this.call("renew", { stack, environment, token }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              failure = error;
            }),
          ),
          Effect.delay("15 seconds"),
          Effect.forever,
          Effect.interruptible,
          Effect.forkDetach,
        );
        const ensure = <A>(operation: Effect.Effect<A, StateError>) =>
          Effect.suspend(() =>
            failure
              ? Effect.fail(failure)
              : ended
                ? Effect.fail(new StateError("busy", "The environment lease has ended."))
                : operation,
          );
        return {
          token,
          read: () => ensure(this.read(stack, environment)),
          write: (state) =>
            ensure(
              Effect.suspend(() =>
                this.call<void>("write", {
                  stack,
                  environment,
                  token,
                  state: JSON.stringify(state),
                }),
              ),
            ),
          removeEmpty: () =>
            ensure(
              Effect.gen({ self: this }, function* () {
                yield* this.call<void>("remove-empty", { stack, environment, token });
                ended = true;
                yield* Fiber.interrupt(renewal);
              }),
            ).pipe(Effect.uninterruptible),
          release: () =>
            Effect.uninterruptible(
              Effect.gen({ self: this }, function* () {
                yield* Fiber.interrupt(renewal);
                if (ended) return;
                ended = true;
                yield* this.call<void>("release", { stack, environment, token });
              }),
            ),
        };
      }),
    );
  }
  gateway(
    stack: string,
    environment: string,
    token: string,
    request: GatewayRequest,
  ): Effect.Effect<GatewayResponse, StateError> {
    return this.call("mutate", { stack, environment, token, request });
  }
}
