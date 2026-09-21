import { decodeState, type EnvironmentState } from "@renkin/core/models/state";
import {
  StateError,
  type StateLease,
  type StateRepository,
} from "@renkin/core/services/state/state-repository";
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
  private async call<T>(action: string, body: CoordinatorRequest): Promise<T> {
    let result: Response;
    try {
      result = await (this.options.fetch ?? fetch)(
        `${this.options.endpoint.replace(/\/$/, "")}/v1/${action}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.stateAuthToken}`,
            "x-renkin-cloudflare-token": this.options.apiToken,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new StateError("unreadable", "Cloud state is unavailable.");
    }
    if (!result.ok) {
      if (result.status === 409)
        throw new StateError(
          "busy",
          "Environment is busy, the lease expired, or a provider operation needs outcome reconciliation.",
        );
      if (result.status === 401 || result.status === 403)
        throw new StateError("unauthorized", "Cloud state authentication failed.");
      throw new StateError(
        "unreadable",
        "Cloud state is unreadable; do not replace it with empty state.",
      );
    }
    try {
      return (await result.json()) as T;
    } catch {
      throw new StateError("invalid", "Cloud state returned an invalid response.");
    }
  }
  async inspect(stack: string, environment: string): Promise<RecoveryInspection> {
    const value = await this.call<unknown>("inspect", { stack, environment });
    if (!validInspection(value)) throw new StateError("invalid", "Recovery inspection is invalid.");
    return value;
  }
  async reconcile(
    stack: string,
    environment: string,
    decision: ReconciliationDecision,
  ): Promise<ReconciliationReceipt> {
    if (!validDecision(decision))
      throw new StateError(
        "invalid",
        "Reconciliation requires exact operation identity, outcome, operator, evidence and explicit provider settlement.",
      );
    const value = await this.call<unknown>("reconcile", { stack, environment, decision });
    if (!validReceipt(value))
      throw new StateError(
        "invalid",
        "Reconciliation receipt is invalid; inspect the exact operation before retrying.",
      );
    return value;
  }
  async read(stack: string, environment: string): Promise<EnvironmentState | undefined> {
    const value = await this.call<string | null>("read", { stack, environment });
    if (value === null) return undefined;
    try {
      return decodeState(value, stack, environment);
    } catch {
      throw new StateError("invalid", "Cloud state is invalid or belongs to another environment.");
    }
  }
  async list(stack: string): Promise<readonly string[]> {
    const value = await this.call<unknown>("list", { stack });
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
      throw new StateError("invalid", "Cloud environment index is invalid.");
    return value;
  }
  async acquire(stack: string, environment: string): Promise<StateLease> {
    const { token } = await this.call<{ token: string }>("acquire", { stack, environment });
    if (typeof token !== "string") throw new StateError("invalid", "Cloud state lease is invalid.");
    let failure: unknown;
    let ended = false;
    const timer = setInterval(() => {
      void this.call("renew", { stack, environment, token }).catch((error: unknown) => {
        failure = error;
      });
    }, 15_000);
    const ensure = () => {
      if (failure) throw failure;
      if (ended) throw new StateError("busy", "The environment lease has ended.");
    };
    return {
      token,
      read: () => {
        ensure();
        return this.read(stack, environment);
      },
      write: (state) => {
        ensure();
        return this.call("write", { stack, environment, token, state: JSON.stringify(state) });
      },
      removeEmpty: async () => {
        ensure();
        await this.call("remove-empty", { stack, environment, token });
        ended = true;
        clearInterval(timer);
      },
      release: async () => {
        clearInterval(timer);
        if (ended) return;
        ended = true;
        await this.call("release", { stack, environment, token });
      },
    };
  }
  gateway(
    stack: string,
    environment: string,
    token: string,
    request: GatewayRequest,
  ): Promise<GatewayResponse> {
    return this.call("mutate", { stack, environment, token, request });
  }
}
