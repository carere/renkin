import { createHash } from "node:crypto";
import type { Json, ResourceDefinition, Stack } from "@renkin/core/models/stack";
import { createBuildContext } from "@renkin/runtime/services/build-reuse/build-context";
import { readBuildResult } from "@renkin/runtime/services/bundler/read-build-result";
import { bundleWorker } from "@renkin/runtime/services/bundler/worker-bundler";
import { Effect } from "effect";
import type { WorkerResource } from "#src/contexts/root/models/worker.ts";
import type { WorkerExtensions } from "#src/contexts/root/models/worker-extensions.ts";
import { prepareD1 } from "#src/contexts/root/services/d1/prepare-d1.ts";
import { prepareDurableObjects } from "#src/contexts/root/services/durable-object/prepare-durable-objects.ts";
import { expandResources } from "./expand-resources.ts";
import { prepareBackgroundResources } from "./prepare-background.ts";
import { finalizeRequirements, prepareRequirements } from "./prepare-requirements.ts";

const prepareResource = (
  resource: ResourceDefinition,
  context: ReturnType<typeof createBuildContext>,
) =>
  Effect.gen(function* () {
    if (resource.type !== "cloudflare.worker") return yield* prepareD1(resource);
    let options = (resource as WorkerResource).options as WorkerResource["options"] &
      WorkerExtensions;
    const builder = options.builder;
    if (!options.build && builder)
      options = {
        ...options,
        build: yield* Effect.tryPromise(() => builder.build(context)),
      };
    const properties = resource.properties as Record<string, Json>;
    if (
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties) ||
      (!options.build && typeof properties.entry !== "string")
    ) {
      return yield* Effect.fail(new Error("Worker entry must be a path."));
    }
    const build = options.build;
    const result = build
      ? yield* Effect.tryPromise(() => readBuildResult(build))
      : {
          source: (yield* Effect.tryPromise(() =>
            bundleWorker(String(properties.entry), { sourceMap: false }),
          )).code,
          mainModule: "worker.mjs",
          modules: [],
        };
    return yield* prepareRequirements(
      {
        ...resource,
        ...{ options },
        properties: {
          ...properties,
          ...(JSON.parse(JSON.stringify(result)) as Record<string, Json>),
          compatibilityDate:
            options.build?.compatibilityDate ?? properties.compatibilityDate ?? "2026-07-30",
          compatibilityFlags: options.build?.compatibilityFlags
            ? [...options.build.compatibilityFlags]
            : (properties.compatibilityFlags ?? ["nodejs_compat"]),
          sourceHash: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
        },
      },
      result.source,
      options.build?.compatibilityDate ?? options.compatibilityDate,
      options.build?.compatibilityFlags ?? options.compatibilityFlags ?? ["nodejs_compat"],
      result,
    );
  });

/** Build before planning so source changes participate in the infrastructure diff. */
export const prepareStack = (stack: Stack) =>
  Effect.gen(function* () {
    const context = createBuildContext();
    return {
      ...stack,
      resources: prepareDurableObjects(
        prepareBackgroundResources(
          finalizeRequirements(
            yield* Effect.all(
              prepareBackgroundResources(expandResources(stack.resources)).map((resource) =>
                prepareResource(resource, context),
              ),
              {
                concurrency: "unbounded",
              },
            ),
          ),
        ),
      ),
    };
  });
