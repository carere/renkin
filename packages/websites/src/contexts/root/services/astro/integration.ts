import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroConfig, AstroIntegration } from "astro";
import { validateConfig } from "astro/config";
import type { AstroResource } from "#src/contexts/root/models/astro.ts";
import { frameworkBindings } from "#src/contexts/root/models/framework-worker.ts";
import { wrapBuildResult } from "#src/contexts/root/services/build/wrap-build-result.ts";
import { buildConfiguration } from "./build-configuration.ts";
import { assetDirectory, buildResult } from "./build-result.ts";

/** Astro CLI integration: configure the native adapter and emit deployment metadata. */
export const renkin = (site: AstroResource): AstroIntegration => {
  let resolved: AstroConfig | undefined;
  let building = false;
  return {
    name: "renkin:astro",
    hooks: {
      "astro:config:setup": async ({ command, config, updateConfig }) => {
        building = command === "build";
        if (!building) return;
        if ((await realpath(fileURLToPath(config.root))) !== (await realpath(site.astro.root)))
          throw new Error("Renkin Astro resource root must match the Astro project root.");
        await rm(resolve(site.astro.root, ".renkin/build-result.json"), { force: true });
        // The programmatic builder already supplies this adapter; do not install it twice.
        if (config.integrations.some((integration) => integration.name === "renkin:astro-build"))
          return;
        if (config.adapter)
          throw new Error(
            "Configure only the Renkin Astro integration; it owns the Cloudflare adapter.",
          );
        const configuration = await buildConfiguration(site.astro);
        const normalized = await validateConfig(configuration, site.astro.root, command);
        if (!normalized.adapter) throw new Error("Renkin Astro adapter is missing.");
        const overrides = Object.fromEntries(
          Object.keys(configuration)
            .filter((key) => !["root", "integrations"].includes(key))
            .map((key) => [key, normalized[key as keyof AstroConfig]]),
        );
        updateConfig({
          ...overrides,
          integrations: [...normalized.integrations, normalized.adapter],
        });
      },
      "astro:config:done": ({ config }) => {
        resolved = config;
      },
      "astro:build:done": async () => {
        if (!building || !resolved) return;
        const result = await buildResult(site.astro, resolved, assetDirectory(resolved));
        const { requirements } = frameworkBindings(site.astro.bindings);
        const artifact = await wrapBuildResult(result, requirements);
        const directory = resolve(site.astro.root, ".renkin");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = resolve(directory, `build-result.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, JSON.stringify(artifact, null, 2), { mode: 0o600 });
          await rename(temporary, resolve(directory, "build-result.json"));
        } finally {
          await rm(temporary, { force: true });
        }
      },
    },
  };
};
