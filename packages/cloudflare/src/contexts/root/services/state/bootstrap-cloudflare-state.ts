import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  type CloudflareConfig,
  createBootstrapClient,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { readStateAuth } from "@renkin/cloudflare-sdk/services/cloudflare-client/state-preview-client";
import { bundleWorker } from "@renkin/runtime/services/bundler/worker-bundler";
import { Effect } from "effect";
import { waitForStateEndpoint } from "./state-endpoint-readiness.ts";
export interface CloudStateOptions extends CloudflareConfig {
  /** Permanent account infrastructure, deliberately separate from environment resources. */
  readonly stateScriptName?: string;
}
export class StateBootstrapError extends Error {
  readonly name = "StateBootstrapError";
}
const ownerTag = "renkin-state-v2";
const missingWorker = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "WorkerNotFound";
const observe = (client: ReturnType<typeof createBootstrapClient>, scriptName: string) =>
  client
    .getWorker(scriptName)
    .pipe(
      Effect.catch((error) =>
        missingWorker(error)
          ? Effect.succeed(undefined)
          : Effect.fail(
              new StateBootstrapError(
                "Could not verify the account state Worker. Check account credentials and permissions.",
              ),
            ),
      ),
    );
type Observation = NonNullable<Effect.Success<ReturnType<typeof observe>>>;
const assertOwned = (observed: Observation, accountId: string): void => {
  const account = observed.bindings?.find((binding) => binding.name === "ACCOUNT_ID");
  const coordinator = observed.bindings?.find((binding) => binding.name === "STATE_COORDINATOR");
  const auth = observed.bindings?.find((binding) => binding.name === "RENKIN_STATE_AUTH");
  if (
    auth?.type !== "secret_text" ||
    !observed.tags?.includes(ownerTag) ||
    account?.type !== "plain_text" ||
    !("text" in account) ||
    account.text !== accountId ||
    coordinator?.type !== "durable_object_namespace" ||
    !("className" in coordinator) ||
    coordinator.className !== "StateCoordinator"
  ) {
    throw new StateBootstrapError(
      "The state Worker name is already occupied by infrastructure that Renkin cannot verify. Choose a different stateScriptName.",
    );
  }
};
const stateName = (options: CloudStateOptions): string => {
  const name = options.stateScriptName ?? "renkin-state-v2";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    throw new StateBootstrapError(
      "The state Worker name must contain 1–63 lowercase letters, digits or hyphens.",
    );
  }
  return name;
};
const endpointFor = (client: ReturnType<typeof createBootstrapClient>, scriptName: string) =>
  Effect.gen(function* () {
    const account = yield* client.getAccountSubdomain();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(account.subdomain)) {
      return yield* Effect.fail(
        new StateBootstrapError("The account has no usable workers.dev subdomain."),
      );
    }
    return { endpoint: `https://${scriptName}.${account.subdomain}.workers.dev`, scriptName };
  });
const authenticate = (
  options: CloudStateOptions,
  endpoint: {
    endpoint: string;
    scriptName: string;
  },
) =>
  Effect.gen(function* () {
    const probe = yield* Effect.tryPromise(() =>
      bundleWorker(fileURLToPath(new URL("./auth-probe-worker.ts", import.meta.url))),
    );
    const stateAuthToken = yield* readStateAuth(options, { ...endpoint, probeSource: probe.code });
    return { ...endpoint, stateAuthToken };
  });

/** State inspection never provisions or changes infrastructure. */
export const findCloudflareState = (options: CloudStateOptions) =>
  Effect.gen(function* () {
    const scriptName = stateName(options);
    const client = createBootstrapClient(options);
    const observed = yield* observe(client, scriptName);
    if (!observed) return undefined;
    assertOwned(observed, options.accountId);
    return yield* Effect.gen(function* () {
      return yield* authenticate(options, yield* endpointFor(client, scriptName));
    }).pipe(
      Effect.mapError(
        () => new StateBootstrapError("The account state endpoint could not be discovered."),
      ),
    );
  });

/** Reuses the protocol-compatible account service without replacing its code or encryption keys. */
export const ensureCloudflareState = (options: CloudStateOptions) =>
  Effect.gen(function* () {
    const scriptName = stateName(options);
    const client = createBootstrapClient(options);
    let observed = yield* observe(client, scriptName);
    if (observed) assertOwned(observed, options.accountId);
    else {
      const bundle = yield* Effect.tryPromise(() =>
        bundleWorker(fileURLToPath(new URL("./coordinator-worker.ts", import.meta.url))),
      );
      yield* Effect.gen(function* () {
        yield* client.putWorker({
          scriptName,
          metadata: {
            mainModule: "coordinator.js",
            compatibilityDate: "2026-09-21",
            tags: [ownerTag],
            bindings: [
              {
                type: "secret_text",
                name: "RENKIN_STATE_AUTH",
                text: randomBytes(32).toString("hex"),
              },
              { type: "plain_text", name: "ACCOUNT_ID", text: options.accountId },
              {
                type: "durable_object_namespace",
                name: "STATE_COORDINATOR",
                className: "StateCoordinator",
              },
            ],
            migrations: { newTag: "v1", newSqliteClasses: ["StateCoordinator"] },
            observability: { enabled: false },
          },
          files: [
            new File([bundle.code], "coordinator.js", { type: "application/javascript+module" }),
          ],
        });
      }).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            // Another initial bootstrap or a lost upload response may already have created it.
            observed = yield* observe(client, scriptName);
            if (!observed)
              return yield* Effect.fail(
                new StateBootstrapError(
                  "Account state provisioning did not complete. Retry to resume setup.",
                ),
              );
            assertOwned(observed, options.accountId);
          }),
        ),
      );
    }
    return yield* Effect.gen(function* () {
      const route = yield* client.getWorkerSubdomain(scriptName);
      if (!route.enabled) yield* client.enableWorkerSubdomain(scriptName);
      const authenticated = yield* authenticate(options, yield* endpointFor(client, scriptName));
      yield* waitForStateEndpoint({ ...authenticated, accountId: options.accountId });
      return authenticated;
    }).pipe(
      Effect.mapError(
        () =>
          new StateBootstrapError(
            "Could not enable the account state endpoint. Verify workers.dev is configured for this account, then retry.",
          ),
      ),
    );
  });
