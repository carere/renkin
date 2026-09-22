import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "./consumer.ts";

export const verifySourceGuard = async (root: string) => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-source-pack-"));
  const manifest = join(root, "packages/renkin/package.json");
  const original = await readFile(manifest, "utf8");
  const archive = join(directory, "wrong-source.tgz");
  try {
    await assert.rejects(
      execute(process.execPath, ["pm", "pack", "--filename", archive], {
        cwd: join(root, "packages/renkin"),
      }),
      (error: unknown) => error instanceof Error && /not.*release artifact/i.test(error.message),
    );
    await assert.rejects(
      access(archive),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    assert.equal(await readFile(manifest, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
