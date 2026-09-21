import type { createKVClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/kv-client";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";

export const cloudflareKVService = (
  client: ReturnType<typeof createKVClient>,
  token: string,
): ResourceService => ({
  apply: async (definition, allocationId, previous) => {
    if (previous) {
      const observed = await Effect.runPromise(client.get(previous.physicalId));
      return { id: observed.id, title: observed.title };
    }
    // The cryptographically random, persisted allocation ID is the ownership marker,
    // not a user-supplied display name. Duplicate matches fail closed.
    const existing = (await Effect.runPromise(client.list())).filter(
      (item) => item.title === allocationId,
    );
    if (existing.length > 1) throw new Error("Ambiguous KV ownership marker.");
    const properties = definition.properties;
    const jurisdiction =
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties) &&
      "jurisdiction" in properties &&
      typeof properties.jurisdiction === "string"
        ? properties.jurisdiction
        : undefined;
    const namespace =
      existing[0] ?? (await Effect.runPromise(client.create(allocationId, jurisdiction, token)));
    return { id: namespace.id, title: namespace.title };
  },
  resolvePhysicalId: (_definition, _allocation, outputs) => {
    if (
      !outputs ||
      typeof outputs !== "object" ||
      Array.isArray(outputs) ||
      !("id" in outputs) ||
      typeof outputs.id !== "string"
    )
      throw new Error("KV provider returned no identity.");
    return outputs.id;
  },
  remove: async (resource) => {
    const namespaces = await Effect.runPromise(client.list());
    const existing = namespaces.find((namespace) => namespace.id === resource.physicalId);
    if (!existing) return;
    const outputs = resource.outputs;
    if (
      !outputs ||
      typeof outputs !== "object" ||
      Array.isArray(outputs) ||
      !("title" in outputs) ||
      existing.title !== outputs.title
    )
      throw new Error("KV ownership does not match the recorded resource.");
    await Effect.runPromise(client.remove(resource.physicalId, token));
  },
});
