import type { createD1Client } from "@renkin/cloudflare-sdk/services/cloudflare-client/d1-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
import { cloudflareD1MigrationExecutor } from "../migrations/cloudflare-d1-migration-executor.ts";
import { applyMigrations } from "../migrations/migration-service.ts";
import { preparedMigrations } from "./prepare-d1.ts";

const record = (value: Json): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid D1 properties or ownership record.");
  return value as Record<string, Json>;
};
const propertiesOf = (definition: ResourceDefinition) => {
  const properties = record(definition.properties);
  if (properties.readReplication !== "auto" && properties.readReplication !== "disabled")
    throw new Error("Invalid D1 replication mode.");
  return {
    readReplication: { mode: properties.readReplication },
    ...(typeof properties.jurisdiction === "string"
      ? { jurisdiction: properties.jurisdiction }
      : {}),
    ...(typeof properties.primaryLocationHint === "string"
      ? { primaryLocationHint: properties.primaryLocationHint }
      : {}),
  };
};

export const cloudflareD1Service = (
  client: ReturnType<typeof createD1Client>,
  token: string,
): ResourceService => {
  const observe = (id: string) =>
    Effect.runPromise(
      client.get(id).pipe(Effect.catchTag("DatabaseNotFound", () => Effect.succeed(undefined))),
    );
  const owned = async (resource: ResourceState) => {
    const observed = await observe(resource.physicalId);
    if (observed && observed.name !== record(resource.outputs).name)
      throw new Error("D1 ownership does not match the recorded resource.");
    return observed;
  };
  return {
    refresh: true,
    apply: async (definition, allocationId, previous) => {
      const properties = propertiesOf(definition);
      if (previous && allocationId === previous.physicalId) {
        const current = await owned(previous);
        if (!current)
          throw new Error(
            "Managed D1 database is missing; refusing to replace stored data implicitly.",
          );
        if (current.readReplication?.mode !== properties.readReplication.mode)
          await Effect.runPromise(
            client.update(
              { databaseId: previous.physicalId, readReplication: properties.readReplication },
              token,
            ),
          );
        return { id: previous.physicalId, name: current.name ?? null };
      }
      const matching = (await Effect.runPromise(client.list(allocationId))).filter(
        (database) => database.name === allocationId,
      );
      if (matching.length > 1) throw new Error("Ambiguous D1 ownership marker.");
      const created =
        matching[0] ??
        (await Effect.runPromise(client.create({ name: allocationId, ...properties }, token)));
      if (!created.uuid || created.name !== allocationId)
        throw new Error("D1 provider returned an invalid identity.");
      return { id: created.uuid, name: created.name };
    },
    resolvePhysicalId: (_definition, _allocation, outputs) => {
      const id = record(outputs).id;
      if (typeof id !== "string" || !id) throw new Error("D1 provider returned no identity.");
      return id;
    },
    bind: async (resource) => {
      if (!(await owned(resource))) throw new Error("Managed D1 database is missing.");
      await Effect.runPromise(
        applyMigrations(
          preparedMigrations(resource.definition),
          cloudflareD1MigrationExecutor(client, resource.physicalId, token),
        ),
      );
    },
    remove: async (resource) => {
      if (!(await owned(resource))) return;
      await Effect.runPromise(client.remove(resource.physicalId, token));
    },
  };
};
