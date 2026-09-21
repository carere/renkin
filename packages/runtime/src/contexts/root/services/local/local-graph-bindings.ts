import type { Miniflare } from "miniflare";
import type { Requirements } from "../../models/binding.ts";
import { guardD1, type NativeD1 } from "../../models/d1.ts";

export const graphBindings = (
  runtime: Miniflare,
  prepared: Readonly<Record<string, { readonly requirements: Requirements }>>,
  databaseIds: Readonly<Record<string, string>> | undefined,
) => {
  const databases = new Map<string, Promise<NativeD1>>();
  return {
    bindings: async (workerId: string): Promise<Record<string, unknown>> => {
      const bindings = await runtime.getBindings(workerId);
      for (const [name, requirement] of Object.entries(prepared[workerId]?.requirements ?? {})) {
        if (requirement.type === "cloudflare.d1")
          bindings[name] = guardD1(bindings[name] as NativeD1);
      }
      return bindings;
    },
    database: async (id: string): Promise<NativeD1> => {
      if (!databaseIds?.[id]) throw new Error("D1 resource is not declared.");
      let database = databases.get(id);
      if (!database) {
        database = runtime
          .getD1Database(id, "__renkin_databases")
          .then((native) => guardD1(native as unknown as NativeD1));
        databases.set(id, database);
      }
      return database;
    },
  };
};
