import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  WorkerDevelopmentContext,
  WorkerDevelopmentSession,
} from "@renkin/runtime/models/worker-builder";
import { createServer } from "vite";
import { frameworkStartup } from "#src/contexts/root/models/framework-startup.ts";
import type { TanStackOptions } from "#src/contexts/root/models/tanstack.ts";
import { createPlatformBridge } from "#src/contexts/root/services/development/platform-bridge.ts";

export const developTanStack = async (
  options: TanStackOptions,
  context: WorkerDevelopmentContext,
): Promise<WorkerDevelopmentSession> => {
  // Each graph frontend owns its optimizer output; canonical paths also avoid
  // macOS /var versus /private/var identities invalidating optimized module URLs.
  const { cacheRoot, root } = await frameworkStartup("prepare-tanstack-directory", async () => {
    await mkdir(context.directory, { recursive: true });
    return { cacheRoot: await realpath(context.directory), root: await realpath(options.root) };
  });
  const bridge = createPlatformBridge();
  const server = await frameworkStartup("create-vite-server", () =>
    createServer({
      root,
      cacheDir: resolve(cacheRoot, "vite"),
      ...(options.configFile ? { configFile: resolve(options.root, options.configFile) } : {}),
      plugins: [bridge.plugin],
      server: {
        host: "127.0.0.1",
        port: options.port ?? 0,
        strictPort: true,
        ...(context.watch ? {} : { watch: null }),
      },
    }),
  );
  try {
    await frameworkStartup("listen-vite-server", () => server.listen());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Vite did not expose a local server.");
    const url = `http://127.0.0.1:${address.port}`;
    return {
      url,
      build: await frameworkStartup("create-forwarding-build", () =>
        // The graph watches this directory recursively; optimizer writes must not reload native bindings.
        bridge.forwardingBuild(resolve(cacheRoot, "worker"), url, {}),
      ),
      connect: bridge.connect,
      close: async () => {
        await server.close();
        await bridge.close();
      },
    };
  } catch (error) {
    await server.close();
    await bridge.close();
    throw error;
  }
};
