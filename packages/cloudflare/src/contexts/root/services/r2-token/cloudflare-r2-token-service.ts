import { createHash } from "node:crypto";
import type {
  AccountTokenInput,
  createAccountTokenClient,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/account-token-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import { ResourceOperationError } from "@renkin/core/services/resource/resource-operation-error";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { canonical } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";

const record = (value: unknown): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ResourceOperationError("Invalid R2 token resource state.");
  return value as Record<string, Json>;
};
const identity = (value: unknown) => {
  const id = record(value).id;
  if (typeof id !== "string" || !id)
    throw new ResourceOperationError("Account token identity is missing.");
  return id;
};
const configuration = (
  client: ReturnType<typeof createAccountTokenClient>,
  accountId: string,
  definition: ResourceDefinition,
  resources: Readonly<Record<string, ResourceState>>,
) =>
  Effect.gen(function* () {
    const properties = record(definition.properties);
    if (
      !Array.isArray(properties.buckets) ||
      !properties.buckets.length ||
      (properties.permissions !== "read-only" && properties.permissions !== "read-write") ||
      typeof properties.expiresAt !== "string"
    )
      return yield* Effect.fail(new ResourceOperationError("Invalid scoped R2 token properties."));
    const buckets: Record<string, string> = {};
    const scopes: Record<string, string> = {};
    const jurisdictions = new Set<string>();
    for (const logicalId of properties.buckets) {
      const bucket =
        typeof logicalId === "string" && Object.hasOwn(resources, logicalId)
          ? resources[logicalId]
          : undefined;
      if (bucket?.definition.type !== "cloudflare.r2")
        return yield* Effect.fail(
          new ResourceOperationError(
            "R2 token bucket must be explicitly owned by this environment.",
          ),
        );
      const jurisdiction = record(bucket.definition.properties).jurisdiction;
      if (typeof jurisdiction !== "string")
        return yield* Effect.fail(new ResourceOperationError("Invalid R2 jurisdiction."));
      jurisdictions.add(jurisdiction);
      buckets[bucket.definition.id] = bucket.physicalId;
      scopes[`com.cloudflare.edge.r2.bucket.${accountId}_${jurisdiction}_${bucket.physicalId}`] =
        "*";
    }
    if (jurisdictions.size !== 1)
      return yield* Effect.fail(
        new ResourceOperationError(
          "One R2 token binding requires buckets in the same jurisdiction.",
        ),
      );
    const jurisdiction = [...jurisdictions][0];
    const permissions = yield* client.permissions();
    const names = [
      "Workers R2 Storage Bucket Item Read",
      ...(properties.permissions === "read-write" ? ["Workers R2 Storage Bucket Item Write"] : []),
    ];
    const groups = names.map((name) => {
      const group = permissions.find(
        (item) => item.name === name && item.scopes?.includes("com.cloudflare.edge.r2.bucket"),
      );
      if (!group?.id)
        throw new ResourceOperationError("Cloudflare R2 object permission group is unavailable.");
      return { id: group.id };
    });
    return { properties, buckets, scopes, jurisdiction, groups };
  });
/** Only exact, state-owned bucket object permissions are available through this resource. */
class CloudflareR2TokenService implements ResourceService {
  readonly refresh = true;
  constructor(
    private readonly client: ReturnType<typeof createAccountTokenClient>,
    private readonly accountId: string,
    private readonly leaseToken: string,
  ) {}
  readonly resolvePhysicalId: NonNullable<ResourceService["resolvePhysicalId"]> = (
    _definition,
    _allocation,
    outputs,
  ) => identity(outputs);
  private credentials(
    desired: AccountTokenInput,
    previous: ResourceState | undefined,
    saved: Record<string, Json> | undefined,
    creationReceipt: string,
  ) {
    return Effect.gen({ self: this }, function* () {
      const { client, leaseToken } = this;
      const replayed = previous
        ? undefined
        : yield* client.replay(desired, leaseToken, creationReceipt);
      const tokens = yield* client.list();
      let observed = replayed?.id
        ? replayed
        : tokens.find((item) =>
            previous ? item.id === previous.physicalId : item.name === desired.name,
          );
      let value = saved?.value ?? replayed?.value;
      if (!observed) {
        if (previous)
          return yield* Effect.fail(
            new ResourceOperationError(
              "Managed R2 token is missing; explicit replacement is required.",
            ),
          );
        if (Date.parse(String(desired.expiresOn)) <= Date.now())
          return yield* Effect.fail(
            new ResourceOperationError("New R2 token expiry must be in the future."),
          );
        const created = yield* client.create(desired, leaseToken, creationReceipt);
        observed = created;
        value = created.value;
      }
      if (observed.name !== desired.name)
        return yield* Effect.fail(
          new ResourceOperationError("Account token ownership differs from its recorded identity."),
        );
      if (typeof value !== "string" || !value)
        return yield* Effect.fail(
          new ResourceOperationError(
            "Account token exists but its one-time secret is unavailable. Reconcile this exact token before replacement; it will not be recreated automatically.",
          ),
        );
      return { observed, value };
    });
  }
  readonly apply: ResourceService["apply"] = (definition, allocation, previous, resources = {}) =>
    Effect.gen({ self: this }, function* () {
      const { client, accountId } = this;
      const { properties, buckets, scopes, jurisdiction, groups } = yield* configuration(
        client,
        accountId,
        definition,
        resources,
      );
      const saved = previous ? record(previous.outputs) : undefined;
      const name = saved?.name ?? allocation;
      if (typeof name !== "string")
        return yield* Effect.fail(
          new ResourceOperationError("R2 token ownership name is missing."),
        );
      const desired: AccountTokenInput = {
        name,
        expiresOn: String(properties.expiresAt),
        policies: [{ effect: "allow", permissionGroups: groups, resources: scopes }],
      };
      const creationReceipt = saved?.creationReceipt ?? `account-token-create:${allocation}`;
      if (typeof creationReceipt !== "string")
        return yield* Effect.fail(
          new ResourceOperationError("R2 token receipt identity is missing."),
        );
      if (saved && canonical(saved.policy ?? null) !== canonical(desired as unknown as Json))
        return yield* Effect.fail(
          new ResourceOperationError(
            "R2 token scope changed. Explicitly replace this token; existing credentials are never silently broadened or rotated.",
          ),
        );
      const { observed, value } = yield* this.credentials(
        desired,
        previous,
        saved,
        creationReceipt,
      );
      const id = identity(observed);
      return {
        id,
        name,
        value,
        creationReceipt,
        policy: desired as unknown as Json,
        accessKeyId: id,
        secretAccessKey: createHash("sha256").update(value).digest("hex"),
        endpoint: `https://${accountId}${jurisdiction === "default" ? "" : `.${jurisdiction}`}.r2.cloudflarestorage.com`,
        region: "auto",
        buckets,
      };
    });
  readonly remove: ResourceService["remove"] = (resource) =>
    Effect.gen({ self: this }, function* () {
      const { client, leaseToken } = this;
      const saved = record(resource.outputs);
      const observed = (yield* client.list()).find((item) => item.id === resource.physicalId);
      if (!observed) return;
      if (observed.id !== saved.id || observed.name !== saved.name)
        return yield* Effect.fail(
          new ResourceOperationError(
            "Account token ownership differs from its recorded identity; revocation refused.",
          ),
        );
      yield* client.remove(resource.physicalId, leaseToken);
    });
}
export const cloudflareR2TokenService = (
  client: ReturnType<typeof createAccountTokenClient>,
  accountId: string,
  leaseToken: string,
): ResourceService => new CloudflareR2TokenService(client, accountId, leaseToken);
