import type {
  AccessApplicationInput,
  AccessPolicyInput,
  AccessServiceTokenInput,
  createAccessClient,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/access-client";
import type { Json } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
import { matchesSupplied, mergeApplicationSettings } from "./access-settings.ts";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Access resource settings.");
  return value as Record<string, unknown>;
};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const id = (value: unknown): string => {
  const result = object(value).id;
  if (typeof result !== "string" || !result)
    throw new Error("Cloudflare did not return an Access resource ID.");
  return result;
};
const dependency = (resources: Readonly<Record<string, ResourceState>>, logicalId: unknown) => {
  if (typeof logicalId !== "string" || !resources[logicalId])
    throw new Error("An Access dependency is not provisioned.");
  return resources[logicalId].physicalId;
};

interface Options {
  readonly client: ReturnType<typeof createAccessClient>;
  readonly token: string;
}
const all = async <A>(
  list: (
    page: number,
  ) => Promise<{ result: A[]; resultInfo?: { totalPages?: number | null } | null }>,
) => {
  const result: A[] = [];
  for (let page = 1; ; page++) {
    const value = await list(page);
    result.push(...value.result);
    if (page >= (value.resultInfo?.totalPages ?? page)) return result;
  }
};
const name = (allocation: string, previous?: ResourceState, label?: unknown) =>
  previous
    ? String(object(previous.outputs).ownershipName)
    : `${typeof label === "string" ? `${label}-` : ""}${allocation}`;
const owned = (observed: unknown, ownershipName: string) => {
  if (object(observed).name !== ownershipName)
    throw new Error("Access resource ownership does not match its recorded allocation.");
};
const result = (observed: unknown, ownershipName: string) =>
  json({ ...object(observed), ownershipName });

const application = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => id(outputs),
  apply: async (definition, allocation, previous, resources = {}) => {
    const settings = object(definition.properties);
    const ownershipName = name(allocation, previous, object(definition.properties).name);
    const policies = Array.isArray(settings.policies)
      ? settings.policies.map((reference, precedence) => ({
          id: dependency(resources, reference),
          precedence: precedence + 1,
        }))
      : undefined;
    const desired = {
      ...settings,
      name: ownershipName,
      ...(policies ? { policies } : {}),
    } as AccessApplicationInput;
    const apps = await all((page) => Effect.runPromise(client.listApplications(page)));
    let observed = apps.find((item) =>
      previous ? item.id === previous.physicalId : item.name === ownershipName,
    );
    if (!observed) {
      if (previous)
        throw new Error(
          "The managed Access application is missing; explicit replacement is required.",
        );
      if (desired.domain && apps.some((item) => "domain" in item && item.domain === desired.domain))
        throw new Error("An existing Access application already protects this domain.");
      const created = await Effect.runPromise(client.createApplication(desired, token));
      observed = await Effect.runPromise(client.getApplication(id(created)));
    } else {
      owned(observed, ownershipName);
      // List views may be abbreviated, so compare and merge the full provider read.
      observed = await Effect.runPromise(client.getApplication(id(observed)));
      if (!matchesSupplied(desired, observed)) {
        await Effect.runPromise(
          client.updateApplication(
            id(observed),
            mergeApplicationSettings(object(observed), desired),
            token,
          ),
        );
        observed = await Effect.runPromise(client.getApplication(id(observed)));
      }
    }
    return result(observed, ownershipName);
  },
  remove: async (resource) => {
    const apps = await all((page) => Effect.runPromise(client.listApplications(page)));
    const observed = apps.find((item) => item.id === resource.physicalId);
    if (!observed) return;
    owned(observed, name(resource.physicalId, resource));
    await Effect.runPromise(client.deleteApplication(resource.physicalId, token));
  },
});

const policy = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => id(outputs),
  apply: async (definition, allocation, previous, resources = {}) => {
    const { serviceTokens, ...settings } = object(definition.properties);
    const ownershipName = name(allocation, previous, object(definition.properties).name);
    const desired = {
      ...settings,
      name: ownershipName,
      include: [
        ...(Array.isArray(settings.include) ? settings.include : []),
        ...(Array.isArray(serviceTokens)
          ? serviceTokens.map((reference) => ({
              serviceToken: { tokenId: dependency(resources, reference) },
            }))
          : []),
      ],
    } as AccessPolicyInput;
    const policies = await all((page) => Effect.runPromise(client.listPolicies(page)));
    let observed = policies.find((item) =>
      previous ? item.id === previous.physicalId : item.name === ownershipName,
    );
    if (!observed) {
      if (previous)
        throw new Error("The managed Access policy is missing; explicit replacement is required.");
      observed = await Effect.runPromise(client.createPolicy(desired, token));
    } else {
      owned(observed, ownershipName);
      if (!matchesSupplied(desired, observed))
        await Effect.runPromise(
          client.updatePolicy(
            id(observed),
            { ...object(observed), ...desired } as AccessPolicyInput,
            token,
          ),
        );
    }
    return result(await Effect.runPromise(client.getPolicy(id(observed))), ownershipName);
  },
  remove: async (resource) => {
    const observed = (await all((page) => Effect.runPromise(client.listPolicies(page)))).find(
      (item) => item.id === resource.physicalId,
    );
    if (!observed) return;
    owned(observed, name(resource.physicalId, resource));
    await Effect.runPromise(client.deletePolicy(resource.physicalId, token));
  },
});

const serviceToken = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => id(outputs),
  apply: async (definition, allocation, previous) => {
    const ownershipName = name(allocation, previous, object(definition.properties).name);
    const desired = {
      ...object(definition.properties),
      name: ownershipName,
    } as unknown as AccessServiceTokenInput;
    const tokens = await all((page) => Effect.runPromise(client.listServiceTokens(page)));
    let observed = tokens.find((item) =>
      previous ? item.id === previous.physicalId : item.name === ownershipName,
    );
    let secret = previous ? object(previous.outputs).clientSecret : undefined;
    if (!observed) {
      if (previous)
        throw new Error(
          "The managed Access service token is missing; explicit replacement is required.",
        );
      const created = await Effect.runPromise(client.createServiceToken(desired, token));
      secret = created.clientSecret;
      observed = created;
    } else {
      owned(observed, ownershipName);
      if (!secret)
        throw new Error(
          "Access token creation completed but its one-time secret was not checkpointed. Reconcile this exact token before replacing it; Renkin will not rotate it automatically.",
        );
      if (!matchesSupplied(desired, observed))
        await Effect.runPromise(client.updateServiceToken(id(observed), desired, token));
    }
    if (typeof secret !== "string" || !secret)
      throw new Error("Cloudflare did not return the new Access token secret.");
    const fresh = await Effect.runPromise(client.getServiceToken(id(observed)));
    return result({ ...fresh, clientSecret: secret }, ownershipName);
  },
  remove: async (resource) => {
    const observed = (await all((page) => Effect.runPromise(client.listServiceTokens(page)))).find(
      (item) => item.id === resource.physicalId,
    );
    if (!observed) return;
    owned(observed, name(resource.physicalId, resource));
    await Effect.runPromise(client.deleteServiceToken(resource.physicalId, token));
  },
});

/** Account reads are authoritative; mutations use the environment's fenced gateway. */
export const cloudflareAccessServices = (options: Options): Record<string, ResourceService> => ({
  "cloudflare.access-application": application(options),
  "cloudflare.access-policy": policy(options),
  "cloudflare.access-service-token": serviceToken(options),
});
