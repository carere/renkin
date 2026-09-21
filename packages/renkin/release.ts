import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assembleRelease } from "./src/contexts/root/services/release/assemble.ts";
import { sha256File } from "./src/contexts/root/services/release/build-info.ts";
import { validateRelease } from "./src/contexts/root/services/release/validate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stage = join(root, ".renkin/release/package");
const command = process.argv[2] ?? "pack";
if (!["build", "pack", "check"].includes(command))
  throw new Error("Use release.ts build, pack or check.");
if (command !== "check") await assembleRelease(root, stage);
const result = await validateRelease(stage, root);
if (command === "pack") {
  const { version } = await import(`${stage}/package.json`);
  const archive = join(root, ".renkin/release", `renkin-${version}.tgz`);
  await promisify(execFile)(process.execPath, ["pm", "pack", "--filename", archive], {
    cwd: stage,
    maxBuffer: 200000,
  });
  const record = {
    ...result,
    archive,
    sha256: await sha256File(archive),
    source: JSON.parse(await readFile(join(stage, "BUILD_INFO.json"), "utf8")),
  };
  await writeFile(
    join(root, ".renkin/release/artifact.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.info(JSON.stringify(record));
} else console.info(JSON.stringify({ ...result, stage }));
