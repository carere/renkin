import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";

export interface WorkerObservability {
  readonly enabled: boolean;
  readonly redactQueryString?: boolean;
  readonly headSamplingRate?: number;
  readonly logs?: {
    readonly enabled: boolean;
    readonly invocationLogs: boolean;
    readonly destinations?: readonly string[];
    readonly headSamplingRate?: number;
    readonly persist?: boolean;
  };
  readonly traces?: {
    readonly enabled?: boolean;
    readonly destinations?: readonly string[];
    readonly headSamplingRate?: number;
    readonly persist?: boolean;
  };
}

export interface WorkerExtensions {
  readonly build?: WorkerBuildResult;
  /** Disable the alternate public origin when protecting a custom domain with Access. */
  readonly workersDev?: boolean;
  readonly observability?: WorkerObservability;
}
