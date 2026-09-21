import type { R2CorsRule } from "@renkin/cloudflare-sdk/services/cloudflare-client/r2-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { R2Requirement } from "@renkin/runtime/models/r2";

export interface R2Options {
  readonly jurisdiction?: "default" | "eu" | "fedramp";
  readonly locationHint?: "wnam" | "enam" | "weur" | "eeur" | "apac" | "oc";
  readonly storageClass?: "Standard" | "InfrequentAccess";
  readonly cors?: readonly R2CorsRule[];
  readonly allowDelete?: boolean;
  /** Separately permits emptying a nonempty bucket during an explicitly allowed removal. */
  readonly forceDestroy?: boolean;
  readonly retain?: boolean;
  readonly identity?: string;
}
export interface R2Resource extends ResourceDefinition, R2Requirement {
  readonly type: "cloudflare.r2";
}
export const r2 = (id: string, options: R2Options = {}): R2Resource => ({
  id,
  type: "cloudflare.r2",
  identity:
    options.identity ??
    `r2:${options.jurisdiction ?? "default"}:${options.locationHint ?? "automatic"}`,
  properties: {
    jurisdiction: options.jurisdiction ?? "default",
    locationHint: options.locationHint ?? null,
    storageClass: options.storageClass ?? "Standard",
    cors: (options.cors ?? []) as unknown as Json,
    forceDestroy: options.forceDestroy ?? false,
  },
  protection: { data: true, allowDelete: options.allowDelete ?? false },
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
