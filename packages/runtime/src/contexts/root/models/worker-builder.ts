import type { WorkerBuildResult } from "./build-result.ts";

/** Framework-owned build work. The result remains independent of the build tool. */
export interface WorkerBuildRecipe {
  build(): Promise<WorkerBuildResult>;
  develop?(context: WorkerDevelopmentContext): Promise<WorkerDevelopmentSession>;
}

export interface WorkerDevelopmentContext {
  readonly directory: string;
  readonly watch: boolean;
  readonly onReload?: () => void;
  readonly onError?: (message: string) => void;
}

export interface WorkerDevelopmentConnection {
  readonly bindings: () => Promise<Record<string, unknown>>;
  /** Native dispatch preserves the browser-visible URL, including signed requests. */
  readonly dispatch: (request: Request) => Promise<Response>;
}

export interface WorkerDevelopmentSession {
  /** A Worker implementation that forwards graph callers to the development server. */
  readonly build: WorkerBuildResult;
  readonly url: string;
  connect(context: WorkerDevelopmentConnection): Promise<void>;
  close(): Promise<void>;
}
