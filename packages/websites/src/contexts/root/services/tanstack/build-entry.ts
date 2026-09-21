import { readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createBuilder } from "vite";

interface BuildInput {
  readonly root: string;
  readonly configFile?: string;
  readonly rendering: "spa" | "ssr";
  readonly manifest: string;
}

const run = async (input: BuildInput) => {
  const builder = await createBuilder({
    root: input.root,
    ...(input.configFile ? { configFile: resolve(input.root, input.configFile) } : {}),
    logLevel: "warn",
  });
  const plugin = builder.config.plugins.find((plugin) => plugin.name === "renkin:tanstack");
  if (!plugin || plugin.api.rendering !== input.rendering)
    throw new Error("Vite config must include renkin(site) for the same rendering mode.");
  await builder.buildApp();
  const server = builder.environments.ssr;
  const client = builder.environments.client;
  if (!server || !client)
    throw new Error("TanStack build did not emit server and client environments.");
  const serverDirectory = resolve(input.root, server.config.build.outDir);
  const clientDirectory = resolve(input.root, client.config.build.outDir);
  const files = await readdir(serverDirectory, { recursive: true });
  const entry = resolve(serverDirectory, "index.js");
  if (!files.includes("index.js")) throw new Error("TanStack Worker entry is missing.");
  const modules = files
    .filter((path) => /\.(?:m?js|wasm)$/.test(path) && path !== "index.js")
    .map((path) => ({
      path,
      type: path.endsWith(".wasm") ? "application/wasm" : "application/javascript+module",
    }));
  const outside = relative(serverDirectory, entry);
  if (outside.startsWith("..") || isAbsolute(outside))
    throw new Error("Invalid Worker output path.");
  await writeFile(
    input.manifest,
    JSON.stringify({ entry, modules, assets: { directory: clientDirectory } }),
  );
};

const input = process.argv[2];
if (!input) throw new Error("Missing framework build input.");
await run(JSON.parse(input) as BuildInput);
