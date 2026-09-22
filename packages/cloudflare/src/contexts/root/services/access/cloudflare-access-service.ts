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
const all = <A>(
  list: (page: number) => Effect.Effect<
    {
      result: A[];
      resultInfo?: {
        totalPages?: number | null;
      } | null;
    },
    Error
  >,
) =>
  Effect.gen(function* () {
    const result: A[] = [];
    for (let page = 1; ; page++) {
      const value = yield* list(page);
      result.push(...value.result);
      if (page >= (value.resultInfo?.totalPages ?? page)) return result;
    }
  });
const name = (allocation: string, previous?: ResourceState, label?: unknown) =>
  previous
    ? String(object(previous.outputs).ownershipName)
    : `${typeof label === "string" ? `${label}-` : ""}${allocation}`;
const owned = (observed: unknown, ownershipName: string) =>
  Effect.try({
    try: () => {
      if (object(observed).name !== ownershipName)
        throw new Error("Access resource ownership does not match its recorded allocation.");
    },
    catch: (error) =>
      error instanceof Error ? error : new Error("Invalid Access ownership record."),
  });
const result = (observed: unknown, ownershipName: string) =>
  json({ ...object(observed), ownershipName });
const application = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => id(outputs),
  apply: (definition, allocation, previous, resources = {}) =>
    Effect.gen(function* () {
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
      const apps = yield* all((page) => client.listApplications(page));
      let observed = apps.find((item) =>
        previous ? item.id === previous.physicalId : item.name === ownershipName,
      );
      if (!observed) {
        if (previous)
          return yield* Effect.fail(
            new Error(
              "The managed Access application is missing; explicit replacement is required.",
            ),
          );
        if (
          desired.domain &&
          apps.some((item) => "domain" in item && item.domain === desired.domain)
        )
          return yield* Effect.fail(
            new Error("An existing Access application already protects this domain."),
          );
        const created = yield* client.createApplication(desired, token);
        observed = yield* client.getApplication(id(created));
      } else {
        yield* owned(observed, ownershipName);
        // List views may be abbreviated, so compare and merge the full provider read.
        observed = yield* client.getApplication(id(observed));
        if (!matchesSupplied(desired, observed)) {
          yield* client.updateApplication(
            id(observed),
            mergeApplicationSettings(object(observed), desired),
            token,
          );
          observed = yield* client.getApplication(id(observed));
        }
      }
      return result(observed, ownershipName);
    }),
  remove: (resource) =>
    Effect.gen(function* () {
      const apps = yield* all((page) => client.listApplications(page));
      const observed = apps.find((item) => item.id === resource.physicalId);
      if (!observed) return;
      yield* owned(observed, name(resource.physicalId, resource));
      yield* client.deleteApplication(resource.physicalId, token);
    }),
});
const policy = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => id(outputs),
  apply: (definition, allocation, previous, resources = {}) =>
    Effect.gen(function* () {
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
      const policies = yield* all((page) => client.listPolicies(page));
      let observed = policies.find((item) =>
        previous ? item.id === previous.physicalId : item.name === ownershipName,
      );
      if (!observed) {
        if (previous)
          return yield* Effect.fail(
            new Error("The managed Access policy is missing; explicit replacement is required."),
          );
        observed = yield* client.createPolicy(desired, token);
      } else {
        yield* owned(observed, ownershipName);
        if (!matchesSupplied(desired, observed))
          yield* client.updatePolicy(
            id(observed),
            { ...object(observed), ...desired } as AccessPolicyInput,
            token,
          );
      }
      return result(yield* client.getPolicy(id(observed)), ownershipName);
    }),
  remove: (resource) =>
    Effect.gen(function* () {
      const observed = (yield* all((page) => client.listPolicies(page))).find(
        (item) => item.id === resource.physicalId,
      );
      if (!observed) return;
      yield* owned(observed, name(resource.physicalId, resource));
      yield* client.deletePolicy(resource.physicalId, token);
    }),
});
const serviceToken = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => id(outputs),
  apply: (definition, allocation, previous) =>
    Effect.gen(function* () {
      const ownershipName = name(allocation, previous, object(definition.properties).name);
      const desired = {
        ...object(definition.properties),
        name: ownershipName,
      } as unknown as AccessServiceTokenInput;
      const creationReceipt = previous
        ? object(previous.outputs).creationReceipt
        : `access-token-create:${allocation}`;
      const replayed =
        !previous && typeof creationReceipt === "string"
          ? yield* client.replayServiceToken(desired, token, creationReceipt)
          : undefined;
      const tokens = yield* all((page) => client.listServiceTokens(page));
      let observed = replayed?.id
        ? replayed
        : tokens.find((item) =>
            previous ? item.id === previous.physicalId : item.name === ownershipName,
          );
      let secret = previous ? object(previous.outputs).clientSecret : replayed?.clientSecret;
      if (!observed) {
        if (previous)
          return yield* Effect.fail(
            new Error(
              "The managed Access service token is missing; explicit replacement is required.",
            ),
          );
        const created = yield* client.createServiceToken(desired, token, String(creationReceipt));
        secret = created.clientSecret;
        observed = created;
      } else {
        yield* owned(observed, ownershipName);
        if (!secret)
          return yield* Effect.fail(
            new Error(
              "Access token creation completed but its one-time secret was not checkpointed. Reconcile this exact token before replacing it; Renkin will not rotate it automatically.",
            ),
          );
        if (!matchesSupplied(desired, observed))
          yield* client.updateServiceToken(id(observed), desired, token);
      }
      if (typeof secret !== "string" || !secret)
        return yield* Effect.fail(
          new Error("Cloudflare did not return the new Access token secret."),
        );
      const fresh = yield* client.getServiceToken(id(observed));
      return result({ ...fresh, clientSecret: secret, creationReceipt }, ownershipName);
    }),
  remove: (resource) =>
    Effect.gen(function* () {
      const observed = (yield* all((page) => client.listServiceTokens(page))).find(
        (item) => item.id === resource.physicalId,
      );
      if (!observed) return;
      yield* owned(observed, name(resource.physicalId, resource));
      yield* client.deleteServiceToken(resource.physicalId, token);
    }),
});

/** Account reads are authoritative; mutations use the environment's fenced gateway. */
export const cloudflareAccessServices = (options: Options): Record<string, ResourceService> => ({
  "cloudflare.access-application": application(options),
  "cloudflare.access-policy": policy(options),
  "cloudflare.access-service-token": serviceToken(options),
});
