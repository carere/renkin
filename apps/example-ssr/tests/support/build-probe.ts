import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tanstackStart } from "@carere/renkin/cloudflare";

/** A custom Vite file checks the real child process environment at build time. */
export const createBuildProbe = async (original: ReturnType<typeof tanstackStart>) => {
  const relative = `.renkin/build-probe-${randomUUID()}.ts`;
  const path = resolve(original.website.root, relative);
  await mkdir(resolve(original.website.root, ".renkin"), { recursive: true });
  await writeFile(
    path,
    `import configuration from ${JSON.stringify(resolve(original.website.root, "vite.config.ts"))};
export default (context) => {
  if (context.command === "build") {
    if (process.env.RENKIN_INHERITED_BUILD_SECRET !== undefined) throw new Error("Inherited host environment leaked into build.");
    if (process.env.RENKIN_EXPLICIT_BUILD_VALUE !== "expected") throw new Error("Explicit build variable was missing.");
  }
  return configuration;
};`,
  );
  const previous = process.env.RENKIN_INHERITED_BUILD_SECRET;
  process.env.RENKIN_INHERITED_BUILD_SECRET = "must-not-reach-child";
  let before = 0;
  let after = 0;
  return {
    site: tanstackStart("Site", {
      ...original.website,
      port: 0,
      configFile: relative,
      buildEnvironment: {
        ...original.website.buildEnvironment,
        RENKIN_EXPLICIT_BUILD_VALUE: "expected",
      },
      beforeBuild: () => {
        before++;
      },
      afterBuild: (result) => {
        after++;
        assert.equal(result.compatibilityDate, "2026-07-30");
        assert.deepEqual(result.compatibilityFlags, ["nodejs_compat"]);
      },
    }),
    verify: () => {
      assert.equal(before, 1);
      assert.equal(after, 1);
    },
    close: async () => {
      await rm(path, { force: true });
      if (previous === undefined) delete process.env.RENKIN_INHERITED_BUILD_SECRET;
      else process.env.RENKIN_INHERITED_BUILD_SECRET = previous;
    },
  };
};
