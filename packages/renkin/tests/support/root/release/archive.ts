import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { sha256File } from "#src/contexts/root/services/release/build-info.ts";
import { execute } from "./consumer.ts";

export const releaseArchive = async (root: string) => {
  const supplied = process.env.RENKIN_RELEASE_ARCHIVE;
  if (supplied) {
    const archive = resolve(supplied);
    const record = JSON.parse(await readFile(join(dirname(archive), "artifact.json"), "utf8"));
    assert.equal(await sha256File(archive), record.sha256);
    assert.equal(record.source.sourceDirty, false, "Canonical external artifact must be clean");
    return archive;
  }
  const packed = await execute(
    process.execPath,
    ["--no-env-file", join(root, "packages/renkin/release.ts"), "pack"],
    { cwd: root, maxBuffer: 200000 },
  );
  return (JSON.parse(packed.stdout) as { archive: string }).archive;
};
