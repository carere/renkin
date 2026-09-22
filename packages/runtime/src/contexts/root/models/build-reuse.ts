import type { WorkerBuildResult } from "./build-result.ts";

export type BuildValue =
  | null
  | boolean
  | number
  | string
  | readonly BuildValue[]
  | {
      readonly [key: string]: BuildValue;
    };

export interface BuildReuseOptions {
  /** Additional files/directories, relative to the application root. Git ignore rules do not apply. */
  readonly inputs?: readonly string[];
  /** Gitignore-style exclusions relative to each input root. */
  readonly exclude?: readonly string[];
  /** Explicit identity for custom hooks/configuration whose captured inputs cannot be inferred. */
  readonly key?: string;
  readonly values?: BuildValue;
  /** All emitted files must belong to this directory. Defaults to the application root. */
  readonly outputRoot?: string;
}

export interface BuildProducer {
  readonly root: string;
  readonly adapter: string;
  readonly values: BuildValue;
  readonly reuse?: BuildReuseOptions | false;
  /** Disable receipts for opaque callbacks while retaining safe capture/output ownership. */
  readonly cacheable?: boolean;
  /** Additional producer outputs, such as an external command manifest. */
  readonly outputFiles?: readonly string[];
  build(context: {
    readonly environment: Readonly<Record<string, string>>;
  }): Promise<WorkerBuildResult>;
}

/** One preparation owns coalescing; no global map of compilation promises. */
export interface WorkerBuildContext {
  resolve(producer: BuildProducer): Promise<WorkerBuildResult>;
}
