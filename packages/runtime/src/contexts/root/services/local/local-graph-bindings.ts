import type { Miniflare } from "miniflare";
import type { Requirements } from "#src/contexts/root/models/binding.ts";
import { guardD1, type NativeD1 } from "#src/contexts/root/models/d1.ts";
import { localWorkflow } from "#src/contexts/root/models/local-workflow.ts";
import type { NativeR2 } from "#src/contexts/root/models/r2.ts";
import type { NativeWorkflow } from "#src/contexts/root/models/workflow-client.ts";

export const graphBindings = (
  runtime: Miniflare,
  prepared: Readonly<Record<string, { readonly requirements: Requirements }>>,
  databaseIds: Readonly<Record<string, string>> | undefined,
  bucketIds?: Readonly<Record<string, string>>,
) => {
  const databases = new Map<string, Promise<NativeD1>>();
  return {
    bucket: async (id: string): Promise<NativeR2> => {
      if (!bucketIds?.[id]) throw new Error("R2 resource is not declared.");
      return (await runtime.getR2Bucket(id, "__renkin_buckets")) as unknown as NativeR2;
    },
    bindings: async (workerId: string): Promise<Record<string, unknown>> => {
      const bindings = await runtime.getBindings(workerId);
      for (const [name, requirement] of Object.entries(prepared[workerId]?.requirements ?? {})) {
        if (requirement.type === "cloudflare.d1")
          bindings[name] = guardD1(bindings[name] as NativeD1);
        if (requirement.type === "cloudflare.workflow")
          bindings[name] = localWorkflow(bindings[name] as NativeWorkflow, name, bindings);
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
