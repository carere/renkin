import { resolve } from "node:path";
import type {
  WorkerDevelopmentContext,
  WorkerDevelopmentSession,
} from "@renkin/runtime/models/worker-builder";
import { createServer } from "vite";
import type { TanStackOptions } from "../../models/tanstack.ts";
import { createPlatformBridge } from "../development/platform-bridge.ts";

export const developTanStack = async (
  options: TanStackOptions,
  context: WorkerDevelopmentContext,
): Promise<WorkerDevelopmentSession> => {
  const bridge = createPlatformBridge();
  const server = await createServer({
    root: options.root,
    ...(options.configFile ? { configFile: resolve(options.root, options.configFile) } : {}),
    plugins: [bridge.plugin],
    server: {
      host: "127.0.0.1",
      port: options.port ?? 0,
      strictPort: true,
      ...(context.watch ? {} : { watch: null }),
    },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Vite did not expose a local server.");
    const url = `http://127.0.0.1:${address.port}`;
    return {
      url,
      build: await bridge.forwardingBuild(context.directory, url, {}),
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
