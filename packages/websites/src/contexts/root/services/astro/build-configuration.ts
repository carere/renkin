import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AstroInlineConfig } from "astro";
import { sessionDrivers } from "astro/config";
import type { AstroBuildOptions } from "#src/contexts/root/models/astro-options.ts";
import { initializeCloudflareTransport } from "#src/contexts/root/services/build-transport/cloudflare-transport.ts";
import { adapterResolution } from "./adapter-resolution.ts";
import { checkedPrerender } from "./checked-prerender.ts";

// Load while Astro evaluates its config; its temporary module runner closes before hooks run.
initializeCloudflareTransport();
const { default: cloudflare } = await import("@astrojs/cloudflare");

const prepareConfiguration = async (
  options: AstroBuildOptions,
  context: { readonly directory?: string },
) => {
  const root = await realpath(resolve(options.root));
  const identity = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const directory = resolve(context.directory ?? resolve(root, ".renkin"), "astro", identity);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configPath = resolve(directory, "worker.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: `renkin-astro-${identity}`,
      compatibility_date: options.compatibilityDate,
      compatibility_flags: options.compatibilityFlags ?? ["nodejs_compat"],
    }),
    { mode: 0o600 },
  );
  return { root, directory, configPath };
};

/** Shared by Astro's CLI integration and Renkin's programmatic builder. */
export const buildConfiguration = async (
  options: AstroBuildOptions,
  context: { readonly directory?: string } = {},
): Promise<AstroInlineConfig> => {
  const { root, configPath } = await prepareConfiguration(options, context);
  return {
    ...options.config,
    root,
    output: options.output,
    vite: {
      ...options.config?.vite,
      plugins: [adapterResolution(), ...(options.config?.vite?.plugins ?? [])],
    },
    session: (options.output === "static" || options.sessionKVBindingName === false
      ? false
      : {
          ...options.session,
          driver: sessionDrivers.cloudflareKVBinding({
            binding: options.sessionKVBindingName ?? "SESSION",
          }),
        }) as NonNullable<AstroInlineConfig["session"]>,
    adapter: checkedPrerender(
      cloudflare({
        configPath,
        remoteBindings: false,
        inspectorPort: false,
        persistState: false,
        imageService: "passthrough",
        sessionKVBindingName: options.sessionKVBindingName || "SESSION",
        prerenderEnvironment: options.prerenderEnvironment ?? "workerd",
      }),
    ),
  };
};
