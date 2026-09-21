/** Framework-independent output accepted from an external build command or adapter. */
export interface WorkerBuildResult {
  /** Already-built ES module. Renkin validates and uploads it without rebundling. */
  readonly entry: string;
  /** Files such as source maps, relative to the entry directory; captured but never uploaded. */
  readonly auxiliaryFiles?: readonly string[];
  /** Additional modules, relative to the entry directory (including WASM and text). */
  readonly modules?: readonly { readonly path: string; readonly type: string }[];
  readonly assets?: {
    readonly directory: string;
    readonly binding?: string;
    readonly config?: AssetRouting;
  };
  readonly compatibilityDate?: string;
  readonly compatibilityFlags?: readonly string[];
}

export interface AssetRouting {
  readonly htmlHandling?:
    | "auto-trailing-slash"
    | "force-trailing-slash"
    | "drop-trailing-slash"
    | "none";
  readonly notFoundHandling?: "none" | "404-page" | "single-page-application";
  readonly runWorkerFirst?: boolean | readonly string[];
}
