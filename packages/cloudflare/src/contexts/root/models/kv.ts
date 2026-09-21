import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { KVRequirement } from "@renkin/runtime/models/binding";
export interface KVOptions {
  readonly jurisdiction?: "eu" | "fedramp" | "us";
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  readonly identity?: string;
}
export interface KVResource extends ResourceDefinition, KVRequirement {
  readonly type: "cloudflare.kv";
}
export const kv = (id: string, options: KVOptions = {}): KVResource => ({
  id,
  type: "cloudflare.kv",
  identity: options.identity ?? `kv:${options.jurisdiction ?? "global"}`,
  properties: { jurisdiction: options.jurisdiction ?? null },
  protection: { data: true, allowDelete: options.allowDelete ?? false },
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
