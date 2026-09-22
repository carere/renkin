import type { ReconciliationDecision } from "@renkin/cloudflare/services/state/reconciliation";
import { validateName } from "@renkin/core/models/stack";
import { StateError } from "@renkin/core/services/state/state-repository";
import { Effect } from "effect";
import { type CloudflareOptions, readCloudState } from "./cloud-environment.ts";

const recovery = <A>(
  stack: string,
  environment: string,
  options: CloudflareOptions | undefined,
  action: (
    state: NonNullable<Effect.Success<ReturnType<typeof readCloudState>>>,
  ) => Effect.Effect<A, StateError>,
) =>
  Effect.gen(function* () {
    validateName(stack);
    validateName(environment);
    const state = yield* readCloudState(options);
    if (!state)
      return yield* Effect.fail(
        new StateError("invalid", "No cloud state service exists for this account."),
      );
    return yield* action(state);
  }).pipe(
    Effect.mapError((error) =>
      error instanceof StateError
        ? error
        : new StateError(
            "unreadable",
            "Recovery state is unavailable. Check account credentials and state service.",
          ),
    ),
    Effect.catchDefect(() =>
      Effect.fail(
        new StateError(
          "unreadable",
          "Recovery state is unavailable. Check account credentials and state service.",
        ),
      ),
    ),
  );

/** Read-only inspection does not evaluate infrastructure or provision a state service. */
export const inspectRecovery = (stack: string, environment: string, options?: CloudflareOptions) =>
  recovery(stack, environment, options, (state) => state.inspect(stack, environment));

/** Records an operator assertion; it cannot prove that Cloudflare has stopped a delayed request. */
export const reconcileOperation = (
  stack: string,
  environment: string,
  decision: ReconciliationDecision,
  options?: CloudflareOptions,
) =>
  recovery(stack, environment, options, (state) => state.reconcile(stack, environment, decision));
