import type { createKVClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/kv-client";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";
export const cloudflareKVService = (
  client: ReturnType<typeof createKVClient>,
  token: string,
): ResourceService => ({
  apply: (definition, allocationId, previous) =>
    Effect.gen(function* () {
      if (previous && allocationId === previous.physicalId) {
        const observed = yield* client.get(previous.physicalId);
        const outputs = previous.outputs;
        if (
          !outputs ||
          typeof outputs !== "object" ||
          Array.isArray(outputs) ||
          !("title" in outputs) ||
          outputs.title !== observed.title
        )
          return yield* Effect.fail(
            new Error("KV ownership does not match the recorded resource."),
          );
        return { id: observed.id, title: observed.title };
      }
      // The cryptographically random, persisted allocation ID is the ownership marker,
      // not a user-supplied display name. Duplicate matches fail closed.
      const existing = (yield* client.list()).filter((item) => item.title === allocationId);
      if (existing.length > 1)
        return yield* Effect.fail(new Error("Ambiguous KV ownership marker."));
      const properties = definition.properties;
      const jurisdiction =
        properties &&
        typeof properties === "object" &&
        !Array.isArray(properties) &&
        "jurisdiction" in properties &&
        typeof properties.jurisdiction === "string"
          ? properties.jurisdiction
          : undefined;
      const namespace = existing[0] ?? (yield* client.create(allocationId, jurisdiction, token));
      return { id: namespace.id, title: namespace.title };
    }),
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
  remove: (resource) =>
    Effect.gen(function* () {
      const namespaces = yield* client.list();
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
        return yield* Effect.fail(new Error("KV ownership does not match the recorded resource."));
      yield* client.remove(resource.physicalId, token);
    }),
});
