import { type WorkerOptions, type WorkerResource, worker } from "@renkin/cloudflare/models/worker";
import type { ResourceDefinition } from "@renkin/core/models/stack";
import type { BindingRequirement, Requirements } from "@renkin/runtime/models/binding";
import type { WorkerBuildRecipe } from "@renkin/runtime/models/worker-builder";
import { wrapBuildResult } from "../services/build/wrap-build-result.ts";

export interface FrameworkWorkerOptions
  extends Omit<WorkerOptions, "build" | "builder" | "entry" | "bindings"> {
  readonly bindings?: Readonly<Record<string, string | BindingRequirement>>;
}

export const frameworkBindings = (bindings: FrameworkWorkerOptions["bindings"] = {}) => {
  const requirements: Record<string, BindingRequirement> = {};
  const constants: Record<string, string> = {};
  const resources: ResourceDefinition[] = [];
  for (const [name, value] of Object.entries(bindings)) {
    if (typeof value === "string") constants[name] = value;
    else {
      requirements[name] = {
        type: value.type,
        id: value.id,
        ...("entrypoint" in value && value.entrypoint ? { entrypoint: value.entrypoint } : {}),
        ...("external" in value && value.external ? { external: value.external } : {}),
      } as BindingRequirement;
      if ("properties" in value && "identity" in value) resources.push(value as ResourceDefinition);
    }
  }
  return { requirements: requirements as Requirements, constants, resources };
};

/** One binding declaration supplies native handles, graph dependencies and build metadata. */
export const frameworkWorker = (
  id: string,
  options: FrameworkWorkerOptions,
  recipe: WorkerBuildRecipe,
): WorkerResource => {
  const { requirements, constants, resources } = frameworkBindings(options.bindings);
  return worker(id, {
    ...options,
    bindings: constants,
    dependencies: [...(options.dependencies ?? []), ...resources],
    builder: {
      build: async (context) => wrapBuildResult(await recipe.build(context), requirements),
      ...(recipe.develop
        ? {
            develop: async (context) => {
              const session = await recipe.develop?.(context);
              if (!session) throw new Error("Framework development recipe is missing.");
              try {
                return { ...session, build: await wrapBuildResult(session.build, requirements) };
              } catch (error) {
                await session.close();
                throw error;
              }
            },
          }
        : {}),
    },
  });
};
