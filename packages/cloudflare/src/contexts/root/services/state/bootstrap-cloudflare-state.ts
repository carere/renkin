import { fileURLToPath } from "node:url";
import {
  type CloudflareConfig,
  createBootstrapClient,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { bundleWorker } from "@renkin/runtime/services/bundler/worker-bundler";
import { Effect } from "effect";

export interface CloudStateOptions extends CloudflareConfig {
  /** Permanent account infrastructure, deliberately separate from environment resources. */
  readonly stateScriptName?: string;
}

export class StateBootstrapError extends Error {
  readonly name = "StateBootstrapError";
}

const ownerTag = "renkin-state-v1";
const missingWorker = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "WorkerNotFound";

const observe = async (client: ReturnType<typeof createBootstrapClient>, scriptName: string) => {
  try {
    return await Effect.runPromise(client.getWorker(scriptName));
  } catch (error) {
    if (missingWorker(error)) return undefined;
    throw new StateBootstrapError(
      "Could not verify the account state Worker. Check account credentials and permissions.",
    );
  }
};
type Observation = NonNullable<Awaited<ReturnType<typeof observe>>>;
const assertOwned = (observed: Observation, accountId: string): void => {
  const account = observed.bindings?.find((binding) => binding.name === "ACCOUNT_ID");
  const coordinator = observed.bindings?.find((binding) => binding.name === "STATE_COORDINATOR");
  if (
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

/** Reuses the protocol-compatible account service without replacing its code or encryption keys. */
export const ensureCloudflareState = async (
  options: CloudStateOptions,
): Promise<{ readonly endpoint: string; readonly scriptName: string }> => {
  const scriptName = options.stateScriptName ?? "renkin-state-v1";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(scriptName)) {
    throw new StateBootstrapError(
      "The state Worker name must contain 1–63 lowercase letters, digits or hyphens.",
    );
  }
  const client = createBootstrapClient(options);
  let observed = await observe(client, scriptName);
  if (observed) assertOwned(observed, options.accountId);
  else {
    const bundle = await bundleWorker(
      fileURLToPath(new URL("./coordinator-worker.ts", import.meta.url)),
    );
    try {
      await Effect.runPromise(
        client.putWorker({
          scriptName,
          metadata: {
            mainModule: "coordinator.js",
            compatibilityDate: "2026-09-21",
            tags: [ownerTag],
            bindings: [
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
        }),
      );
    } catch {
      // Another initial bootstrap or a lost upload response may already have created it.
      observed = await observe(client, scriptName);
      if (!observed)
        throw new StateBootstrapError(
          "Account state provisioning did not complete. Retry to resume setup.",
        );
      assertOwned(observed, options.accountId);
    }
  }
  try {
    await Effect.runPromise(client.enableWorkerSubdomain(scriptName));
    const account = await Effect.runPromise(client.getAccountSubdomain());
    if (!/^[a-z0-9][a-z0-9-]*$/.test(account.subdomain)) {
      throw new StateBootstrapError("The account has no usable workers.dev subdomain.");
    }
    return { endpoint: `https://${scriptName}.${account.subdomain}.workers.dev`, scriptName };
  } catch {
    throw new StateBootstrapError(
      "Could not enable the account state endpoint. Verify workers.dev is configured for this account, then retry.",
    );
  }
};
