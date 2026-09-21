import type {
  AccessApplicationInput,
  AccessPolicyInput,
  AccessServiceTokenInput,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/access-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";

export interface ResourceOptions {
  readonly identity?: string;
  readonly retain?: boolean;
}
export interface AccessServiceToken extends ResourceDefinition {
  readonly type: "cloudflare.access-service-token";
}
export interface AccessPolicy extends ResourceDefinition {
  readonly type: "cloudflare.access-policy";
}
export interface AccessApplication extends ResourceDefinition {
  readonly type: "cloudflare.access-application";
}
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

export const accessServiceToken = (
  id: string,
  options: AccessServiceTokenInput & ResourceOptions,
): AccessServiceToken => {
  const { identity, retain, ...settings } = options;
  return {
    id,
    type: "cloudflare.access-service-token",
    secretOutputs: true,
    identity: identity ?? `${id}:${settings.name ?? ""}`,
    properties: json(settings),
    ...(retain === undefined ? {} : { retain }),
  };
};

export const accessPolicy = (
  id: string,
  options: Omit<AccessPolicyInput, "include"> &
    ResourceOptions & {
      readonly include?: AccessPolicyInput["include"];
      /** Service-token rules and dependency order come from the same references. */
      readonly serviceTokens?: readonly AccessServiceToken[];
    },
): AccessPolicy => {
  const { identity, retain, serviceTokens = [], ...settings } = options;
  return {
    id,
    type: "cloudflare.access-policy",
    identity: identity ?? `${id}:${settings.name ?? ""}`,
    properties: json({ ...settings, serviceTokens: serviceTokens.map((token) => token.id) }),
    dependencies: serviceTokens.map((token) => token.id),
    ...(retain === undefined ? {} : { retain }),
  };
};

export const accessApplication = (
  id: string,
  options: Omit<AccessApplicationInput, "policies"> &
    ResourceOptions & {
      readonly policies?: readonly AccessPolicy[];
    },
): AccessApplication => {
  const { identity, retain, policies, ...settings } = options;
  if (settings.type && settings.type !== "self_hosted")
    throw new Error("Renkin Access applications currently support self_hosted applications.");
  return {
    id,
    type: "cloudflare.access-application",
    identity: identity ?? `${id}:${settings.name ?? ""}`,
    properties: json({
      ...settings,
      type: "self_hosted",
      ...(policies ? { policies: policies.map((policy) => policy.id) } : {}),
    }),
    dependencies: (policies ?? []).map((policy) => policy.id),
    ...(retain === undefined ? {} : { retain }),
  };
};
