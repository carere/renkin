import type { ReconciliationDecision } from "@renkin/cloudflare/services/state/reconciliation";
import { validateName } from "@renkin/core/models/stack";
import { StateError } from "@renkin/core/services/state/state-repository";
import { Effect } from "effect";
import { type CloudflareOptions, readCloudState } from "./cloud-environment.ts";

const recovery = <A>(
  stack: string,
  environment: string,
  options: CloudflareOptions | undefined,
  action: (state: NonNullable<Awaited<ReturnType<typeof readCloudState>>>) => Promise<A>,
) =>
  Effect.tryPromise({
    try: async () => {
      validateName(stack);
      validateName(environment);
      const state = await readCloudState(options);
      if (!state)
        throw new StateError("invalid", "No cloud state service exists for this account.");
      return action(state);
    },
    catch: (error) =>
      error instanceof StateError
        ? error
        : new StateError(
            "unreadable",
            "Recovery state is unavailable. Check account credentials and state service.",
          ),
  });

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
