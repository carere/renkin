import type { BuildReuseOptions, BuildValue } from "./build-reuse.ts";

export interface BuildCommandOptions {
  /** Executable and arguments, without shell evaluation. */
  readonly command: readonly [string, ...string[]];
  readonly cwd: string;
  /** JSON WorkerBuildResult written by the command, relative to cwd. */
  readonly manifest: string;
  /** Source root, relative to cwd; defaults to cwd. */
  readonly root?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly reuse?: BuildReuseOptions | false;
  readonly values?: BuildValue;
}
