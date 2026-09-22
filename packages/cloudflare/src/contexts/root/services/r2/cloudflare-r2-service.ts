import type {
  createR2Client,
  R2CorsRule,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/r2-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import { ResourceOperationError } from "@renkin/core/services/resource/resource-operation-error";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { canonical } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";

const record = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid R2 resource record.");
  return value as Record<string, Json>;
};
const properties = (definition: ResourceDefinition) => {
  const value = record(definition.properties);
  if (
    typeof value.jurisdiction !== "string" ||
    typeof value.storageClass !== "string" ||
    !Array.isArray(value.cors)
  )
    throw new Error("Invalid R2 properties.");
  return {
    jurisdiction: value.jurisdiction,
    storageClass: value.storageClass,
    cors: value.cors as unknown as R2CorsRule[],
    ...(typeof value.locationHint === "string" ? { locationHint: value.locationHint } : {}),
  };
};
class CloudflareR2Service implements ResourceService {
  readonly refresh = true;
  constructor(
    private readonly client: ReturnType<typeof createR2Client>,
    private readonly token: string,
  ) {}
  private readonly observe = (name: string, jurisdiction: string) =>
    this.client
      .get(name, jurisdiction)
      .pipe(Effect.catchTag("NoSuchBucket", () => Effect.succeed(undefined)));
  private readonly owned = (resource: ResourceState) =>
    Effect.gen({ self: this }, function* () {
      const value = properties(resource.definition);
      const found = yield* this.observe(resource.physicalId, value.jurisdiction);
      const output = record(resource.outputs);
      if (
        found &&
        (found.name !== resource.physicalId ||
          found.name !== output.name ||
          !found.creationDate ||
          found.creationDate !== output.creationDate)
      )
        return yield* Effect.fail(
          new ResourceOperationError(
            "R2 ownership differs from the recorded bucket; refusing to change it.",
          ),
        );
      return found;
    });
  private readonly configure = (name: string, definition: ResourceDefinition) =>
    Effect.gen({ self: this }, function* () {
      const value = properties(definition);
      const current = yield* this.client
        .cors(name, value.jurisdiction)
        .pipe(Effect.catchTag("NoCorsConfiguration", () => Effect.succeed({ rules: [] })));
      if (
        canonical((current.rules ?? []) as unknown as Json) !==
        canonical(value.cors as unknown as Json)
      ) {
        if (value.cors.length)
          yield* this.client.setCors(
            { bucketName: name, jurisdiction: value.jurisdiction, rules: value.cors },
            this.token,
          );
        else yield* this.client.clearCors(name, value.jurisdiction, this.token);
      }
    });
  readonly apply: ResourceService["apply"] = (definition, allocationId, previous) =>
    Effect.gen({ self: this }, function* () {
      const value = properties(definition);
      if (previous && allocationId === previous.physicalId) {
        const original = properties(previous.definition);
        if (
          value.jurisdiction !== original.jurisdiction ||
          value.locationHint !== original.locationHint
        )
          return yield* Effect.fail(
            new ResourceOperationError(
              "R2 jurisdiction and location changes require explicit resource replacement.",
            ),
          );
      }
      const name = allocationId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      let found =
        previous && allocationId === previous.physicalId
          ? yield* this.owned(previous)
          : yield* this.observe(name, value.jurisdiction);
      if (previous && allocationId === previous.physicalId && !found)
        return yield* Effect.fail(
          new ResourceOperationError(
            "Managed R2 bucket is missing; refusing to recreate stored data implicitly.",
          ),
        );
      found ??= yield* this.client.create(
        {
          name,
          jurisdiction: value.jurisdiction,
          storageClass: value.storageClass,
          ...(value.locationHint ? { locationHint: value.locationHint } : {}),
        },
        this.token,
      );
      if (found.name !== name || !found.creationDate)
        return yield* Effect.fail(new Error("R2 provider returned no stable identity."));
      if (found.storageClass !== value.storageClass)
        yield* this.client.update(
          {
            bucketName: name,
            jurisdiction: value.jurisdiction,
            storageClass: value.storageClass,
          },
          this.token,
        );
      yield* this.configure(name, definition);
      return { name, creationDate: found.creationDate, jurisdiction: value.jurisdiction };
    });
  readonly resolvePhysicalId: NonNullable<ResourceService["resolvePhysicalId"]> = (
    _definition,
    _allocation,
    output,
  ) => {
    const name = record(output).name;
    if (typeof name !== "string" || !name) throw new Error("R2 provider returned no identity.");
    return name;
  };
  readonly remove: ResourceService["remove"] = (resource, resources, currentDesired) =>
    Effect.gen({ self: this }, function* () {
      if (!(yield* this.owned(resource))) return;
      const value = properties(resource.definition);
      const replacement = resources?.[resource.definition.id];
      const permission =
        replacement &&
        replacement.physicalId !== resource.physicalId &&
        replacement.definition.type === resource.definition.type
          ? replacement.definition
          : (currentDesired ?? resource.definition);
      for (;;) {
        const page = yield* this.client.objects({
          bucketName: resource.physicalId,
          cfR2Jurisdiction: value.jurisdiction,
          perPage: 1000,
        });
        if (!page.result.length) break;
        if (record(permission.properties).forceDestroy !== true)
          return yield* Effect.fail(
            new ResourceOperationError(
              "R2 bucket contains objects. Explicit forceDestroy permission is required to empty it before deletion.",
            ),
          );
        for (const object of page.result) {
          if (typeof object.key !== "string")
            return yield* Effect.fail(new Error("R2 returned an invalid object identity."));
          yield* this.client
            .removeObject(resource.physicalId, object.key, value.jurisdiction, this.token)
            .pipe(
              Effect.catchTag("R2ObjectKeyError", () =>
                Effect.fail(
                  new ResourceOperationError(
                    "R2 cleanup cannot safely address an object key containing dot path segments. Remove that exact object through its native binding or S3 API, then retry; bucket ownership is preserved.",
                  ),
                ),
              ),
            );
        }
      }
      yield* this.client.remove(resource.physicalId, value.jurisdiction, this.token);
    });
}
export const cloudflareR2Service = (
  client: ReturnType<typeof createR2Client>,
  token: string,
): ResourceService => new CloudflareR2Service(client, token);
