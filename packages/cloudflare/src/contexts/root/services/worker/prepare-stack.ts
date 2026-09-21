import { createHash } from "node:crypto";
import type { Json, Stack } from "@renkin/core/models/stack";
import { createBuildContext } from "@renkin/runtime/services/build-reuse/build-context";
import { readBuildResult } from "@renkin/runtime/services/bundler/read-build-result";
import { bundleWorker } from "@renkin/runtime/services/bundler/worker-bundler";
import type { WorkerResource } from "#src/contexts/root/models/worker.ts";
import type { WorkerExtensions } from "#src/contexts/root/models/worker-extensions.ts";
import { prepareD1 } from "#src/contexts/root/services/d1/prepare-d1.ts";
import { prepareDurableObjects } from "#src/contexts/root/services/durable-object/prepare-durable-objects.ts";
import { expandResources } from "./expand-resources.ts";
import { prepareBackgroundResources } from "./prepare-background.ts";
import { finalizeRequirements, prepareRequirements } from "./prepare-requirements.ts";

/** Build before planning so source changes participate in the infrastructure diff. */
export const prepareStack = async (stack: Stack): Promise<Stack> => {
  const context = createBuildContext();
  return {
    ...stack,
    resources: prepareDurableObjects(
      prepareBackgroundResources(
        finalizeRequirements(
          await Promise.all(
            prepareBackgroundResources(expandResources(stack.resources)).map(async (resource) => {
              if (resource.type !== "cloudflare.worker") return prepareD1(resource);
              let options = (resource as WorkerResource).options as WorkerResource["options"] &
                WorkerExtensions;
              if (!options.build && options.builder)
                options = { ...options, build: await options.builder.build(context) };
              const properties = resource.properties as Record<string, Json>;
              if (
                !properties ||
                typeof properties !== "object" ||
                Array.isArray(properties) ||
                (!options.build && typeof properties.entry !== "string")
              ) {
                throw new Error("Worker entry must be a path.");
              }
              const result = options.build
                ? await readBuildResult(options.build)
                : {
                    source: (await bundleWorker(String(properties.entry), { sourceMap: false }))
                      .code,
                    mainModule: "worker.mjs",
                    modules: [],
                  };
              return prepareRequirements(
                {
                  ...resource,
                  ...{ options },
                  properties: {
                    ...properties,
                    ...(JSON.parse(JSON.stringify(result)) as Record<string, Json>),
                    compatibilityDate:
                      options.build?.compatibilityDate ??
                      properties.compatibilityDate ??
                      "2026-07-30",
                    compatibilityFlags: options.build?.compatibilityFlags
                      ? [...options.build.compatibilityFlags]
                      : (properties.compatibilityFlags ?? ["nodejs_compat"]),
                    sourceHash: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
                  },
                },
                result.source,
                options.build?.compatibilityDate ?? options.compatibilityDate,
                options.build?.compatibilityFlags ??
                  options.compatibilityFlags ?? ["nodejs_compat"],
                result,
              );
            }),
          ),
        ),
      ),
    ),
  };
};
