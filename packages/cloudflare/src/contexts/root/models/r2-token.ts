import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { R2TokenRequirement } from "@renkin/runtime/models/r2-token";
import type { R2Resource } from "./r2.ts";

export interface R2TokenOptions {
  readonly buckets: readonly R2Resource[];
  readonly permissions: "read-only" | "read-write";
  /** Explicit absolute expiry; preview rotation requires an explicit resource replacement. */
  readonly expiresAt: string;
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  /** Explicit rotation trigger, for example after replacing a bucket with the same logical ID. */
  readonly identity?: string;
}
export interface R2TokenResource
  extends ResourceDefinition<{
      accessKeyId: string;
      secretAccessKey: string;
      endpoint: string;
      region: string;
      buckets: readonly string[];
    }>,
    R2TokenRequirement {
  readonly type: "cloudflare.r2-token";
}
export const r2Token = (id: string, options: R2TokenOptions): R2TokenResource => {
  const buckets = options.buckets.map((bucket) => bucket.id).sort();
  if (!buckets.length || new Set(buckets).size !== buckets.length)
    throw new Error("R2 token requires distinct, explicitly declared buckets.");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(options.expiresAt) ||
    !Number.isFinite(Date.parse(options.expiresAt)) ||
    new Date(options.expiresAt).toISOString().replace(".000Z", "Z") !== options.expiresAt
  )
    throw new Error(
      "R2 token expiry must be an absolute UTC timestamp without fractional seconds.",
    );
  return {
    id,
    type: "cloudflare.r2-token",
    identity: options.identity ?? JSON.stringify([buckets, options.permissions, options.expiresAt]),
    properties: { buckets, permissions: options.permissions, expiresAt: options.expiresAt },
    dependencies: buckets,
    secretOutputs: true,
    protection: { data: true, allowDelete: options.allowDelete ?? false },
    ...(options.retain === undefined ? {} : { retain: options.retain }),
  };
};
