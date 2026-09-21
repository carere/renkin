import { decodeState, type EnvironmentState } from "@renkin/core/models/state";
import {
  StateError,
  type StateLease,
  type StateRepository,
} from "@renkin/core/services/state/state-repository";
import type { CoordinatorRequest, GatewayRequest, GatewayResponse } from "./state-protocol.ts";

export interface CloudflareStateOptions {
  readonly endpoint: string;
  readonly apiToken: string;
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
            authorization: `Bearer ${this.options.apiToken}`,
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
        throw new StateError("unauthorized", "Cloud state account authentication failed.");
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
    const timer = setInterval(() => {
      void this.call("renew", { stack, environment, token }).catch((error: unknown) => {
        failure = error;
      });
    }, 15_000);
    const ensure = () => {
      if (failure) throw failure;
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
      release: async () => {
        clearInterval(timer);
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
