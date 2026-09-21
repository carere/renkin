import { mkdir, realpath, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WorkerDevelopmentContext,
  WorkerDevelopmentSession,
} from "@renkin/runtime/models/worker-builder";
import { type AstroInlineConfig, dev } from "astro";
import type { AstroBuildOptions } from "../../models/astro-options.ts";
import { createPlatformBridge } from "../development/platform-bridge.ts";

const driverEntry = async (directory: string, binding: string): Promise<string> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = resolve(directory, "astro-session-driver.mjs");
  const driver = fileURLToPath(new URL("./session-driver.ts", import.meta.url));
  await writeFile(
    entry,
    `import {env} from "cloudflare:workers";
import {sessionDriver} from ${JSON.stringify(driver)};
export default () => sessionDriver(() => env[${JSON.stringify(binding)}]);\n`,
  );
  return entry;
};

/** Uses Astro's native reload server; storage remains in Renkin's one local resource graph. */
export const developAstro = async (
  options: AstroBuildOptions,
  context: WorkerDevelopmentContext,
): Promise<WorkerDevelopmentSession> => {
  const bridge = createPlatformBridge();
  const root = await realpath(resolve(options.root));
  const session =
    options.output === "static" || options.sessionKVBindingName === false
      ? false
      : {
          ...options.session,
          driver: {
            entrypoint: await driverEntry(
              context.directory,
              options.sessionKVBindingName ?? "SESSION",
            ),
          },
        };
  const server = await dev({
    logLevel: "silent",
    ...options.config,
    root,
    ...(options.configFile === undefined
      ? {}
      : {
          configFile:
            options.configFile === false
              ? false
              : relative(root, resolve(root, options.configFile)),
        }),
    output: options.output,
    adapter: { name: "renkin:astro-development", hooks: {} },
    // Astro 7's programmatic config defaults its driver generic to never.
    session: session as NonNullable<AstroInlineConfig["session"]>,
    server: { host: "127.0.0.1", port: 0, ...options.config?.server },
    vite: {
      ...options.config?.vite,
      plugins: [bridge.plugin, ...(options.config?.vite?.plugins ?? [])],
      server: { ...options.config?.vite?.server, ...(context.watch ? {} : { watch: null }) },
    },
  });
  if (context.onReload) server.watcher.on("change", context.onReload);
  const url = `http://127.0.0.1:${server.address.port}`;
  const close = async () => {
    await server.stop();
    await bridge.close();
  };
  try {
    return {
      url,
      build: await bridge.forwardingBuild(context.directory, url, {}),
      connect: bridge.connect,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
