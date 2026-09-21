import type { AssetRouting } from "@renkin/runtime/models/build-result";
import type { AstroInlineConfig } from "astro";

/** Astro owns page generation; Renkin owns bindings and deployment. */
export interface AstroBuildOptions {
  readonly root: string;
  /** Frontend development port; zero chooses an available port. */
  readonly port?: number;
  readonly output: "static" | "server";
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly assetRouting?: AssetRouting;
  /** Alternate Astro configuration file, relative to root; false disables discovery. */
  readonly configFile?: string | false;
  /** Ordinary Astro configuration, including site/base, directories, routing and Vite hooks. */
  readonly config?: Omit<
    AstroInlineConfig,
    "root" | "output" | "adapter" | "session" | "configFile"
  >;
  /** SSR defaults to SESSION. False disables sessions; static mode always disables them. */
  readonly sessionKVBindingName?: string | false;
  readonly session?: Omit<Exclude<AstroInlineConfig["session"], false | undefined>, "driver">;
  /** Production page generation uses workerd unless explicitly changed. */
  readonly prerenderEnvironment?: "workerd" | "node";
}
