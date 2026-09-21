import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Requirements } from "@renkin/runtime/models/binding";
import type { WorkerBuildResult } from "@renkin/runtime/models/build-result";

/** Add declarative bindings without rebundling framework-generated modules. */
export const wrapBuildResult = async (
  build: WorkerBuildResult,
  requirements: Requirements,
): Promise<WorkerBuildResult> => {
  const main = basename(build.entry);
  const code = `import server from ${JSON.stringify(`./${main}`)};
export * from ${JSON.stringify(`./${main}`)};
export default {...server,__renkinRequirements:${JSON.stringify(requirements)}};\n`;
  const hash = createHash("sha256").update(code).digest("hex");
  const entry = resolve(dirname(build.entry), `renkin-entry-${hash}.mjs`);
  const temporary = `${entry}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, code, { mode: 0o600 });
    await rename(temporary, entry);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    ...build,
    entry,
    modules: [{ path: main, type: "application/javascript+module" }, ...(build.modules ?? [])],
  };
};
