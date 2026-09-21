import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { fingerprint } from "#src/contexts/root/services/build-reuse/fingerprint.ts";

it("tracks transitive workspace source, ignored public inputs, lockfiles and added or removed files", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "renkin-workspace-inputs-"));
  try {
    const app = resolve(root, "apps/site");
    const shared = resolve(root, "packages/shared");
    await mkdir(resolve(app, "public"), { recursive: true });
    await mkdir(shared, { recursive: true });
    await writeFile(
      resolve(root, "package.json"),
      JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
    );
    await writeFile(resolve(root, "bun.lock"), "initial lock");
    await writeFile(
      resolve(app, "package.json"),
      JSON.stringify({ dependencies: { shared: "workspace:*" } }),
    );
    await writeFile(resolve(shared, "package.json"), JSON.stringify({ name: "shared" }));
    await writeFile(resolve(shared, "source.ts"), "export const title = 'first';");
    await writeFile(resolve(app, ".gitignore"), "public/deployment.json\n");
    const producer = {
      root: app,
      adapter: "test",
      values: {},
      build: async () => ({ entry: "unused" }),
    };
    let previous = await fingerprint(producer);
    for (const [path, content] of [
      [resolve(shared, "source.ts"), "export const title = 'second';"],
      [resolve(root, "bun.lock"), "updated lock"],
      [resolve(app, "public/deployment.json"), '{"stage":"preview"}'],
      [resolve(app, "vite.config.ts"), "export default {};"],
    ] as const) {
      await writeFile(path, content);
      const next = await fingerprint(producer);
      expect(next).not.toBe(previous);
      previous = next;
    }
    await rm(resolve(app, "public/deployment.json"));
    expect(await fingerprint(producer)).not.toBe(previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
