import type { ResourceDefinition } from "@renkin/core/models/stack";

export interface WorkerOptions {
  readonly entry: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly bindings?: Readonly<Record<string, string>>;
  readonly port?: number;
  /** Explicit replacement trigger. Defaults to the logical ID. */
  readonly identity?: string;
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
}

export interface WorkerResource extends ResourceDefinition {
  readonly type: "cloudflare.worker";
  readonly options: WorkerOptions;
}

export const worker = (id: string, options: WorkerOptions): WorkerResource => ({
  id,
  type: "cloudflare.worker",
  identity: options.identity ?? id,
  properties: {
    entry: options.entry,
    compatibilityDate: options.compatibilityDate,
    compatibilityFlags: options.compatibilityFlags ?? ["nodejs_compat"],
    bindings: options.bindings ?? {},
  },
  options,
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
