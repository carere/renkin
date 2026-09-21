import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { D1Requirement } from "@renkin/runtime/models/d1";

export interface D1Options {
  readonly migrations?: string;
  readonly jurisdiction?: "eu" | "fedramp";
  readonly primaryLocationHint?: "wnam" | "enam" | "weur" | "eeur" | "apac" | "oc";
  readonly readReplication?: "auto" | "disabled";
  readonly allowDelete?: boolean;
  readonly retain?: boolean;
  readonly identity?: string;
}
export interface D1Resource extends ResourceDefinition, D1Requirement {
  readonly type: "cloudflare.d1";
}
export const d1 = (id: string, options: D1Options = {}): D1Resource => ({
  id,
  type: "cloudflare.d1",
  identity:
    options.identity ??
    `d1:${options.jurisdiction ?? "global"}:${options.primaryLocationHint ?? "automatic"}`,
  properties: {
    migrations: options.migrations ?? null,
    jurisdiction: options.jurisdiction ?? null,
    primaryLocationHint: options.primaryLocationHint ?? null,
    readReplication: options.readReplication ?? "disabled",
  },
  protection: { data: true, allowDelete: options.allowDelete ?? false },
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});
