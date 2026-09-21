import { writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Requirements } from "@renkin/runtime/models/binding";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";

/** Add declarative bindings without rebundling framework-generated modules. */
export const wrapBuildResult = async (
  build: WorkerBuildResult,
  requirements: Requirements,
): Promise<WorkerBuildResult> => {
  const main = basename(build.entry);
  const entry = resolve(dirname(build.entry), "renkin-entry.mjs");
  if (build.entry === entry) throw new Error("Framework entry conflicts with Renkin's wrapper.");
  await writeFile(
    entry,
    `import server from ${JSON.stringify(`./${main}`)};
export * from ${JSON.stringify(`./${main}`)};
export default {...server,__renkinRequirements:${JSON.stringify(requirements)}};\n`,
  );
  return {
    ...build,
    entry,
    modules: [{ path: main, type: "application/javascript+module" }, ...(build.modules ?? [])],
  };
};
