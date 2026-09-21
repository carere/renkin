import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { withBuildOutput } from "../../../../../src/contexts/root/services/build-reuse/output-lock.ts";

it("rejects another process while output is owned and releases only after its capture completes", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "renkin-output-owner-"));
  const module = new URL(
    "../../../../../src/contexts/root/services/build-reuse/output-lock.ts",
    import.meta.url,
  ).href;
  const script = resolve(directory, "owner.ts");
  await writeFile(
    script,
    `import {withBuildOutput} from ${JSON.stringify(module)};
await withBuildOutput(${JSON.stringify(directory)},async()=>{
console.log('owned');await new Promise(resolve=>process.stdin.once('data',resolve));
process.stdin.destroy();
});`,
  );
  const child = spawn(process.versions.bun ? process.execPath : "bun", ["--no-env-file", script], {
    env: { ...process.env, PROTO_OFFLINE: "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  try {
    await once(child.stdout, "data");
    let touched = false;
    await expect(
      withBuildOutput(directory, async () => {
        touched = true;
      }),
    ).rejects.toThrow("Build output is busy");
    expect(touched).toBe(false);
    child.stdin.write("release\n");
    expect((await exited)[0]).toBe(0);
    await withBuildOutput(directory, async () => {
      touched = true;
    });
    expect(touched).toBe(true);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
