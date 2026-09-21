import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";
import type { WorkerBuildRecipe } from "@renkin/runtime/models/worker-builder";

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
  /** Build/development lifecycle supplied by a framework integration. */
  readonly builder?: WorkerBuildRecipe;
  /** Disable the alternate public origin when protecting a custom domain with Access. */
  readonly workersDev?: boolean;
  readonly observability?: WorkerObservability;
}
