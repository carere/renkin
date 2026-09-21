import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { compileFunction } from "node:vm";

type Loader = {
  plugin(options: {
    name: string;
    setup(builder: {
      onLoad(
        options: { filter: RegExp },
        callback: (args: {
          path: string;
        }) => { loader: "object"; exports: Record<string, unknown> } | undefined,
      ): void;
    }): void;
  }): void;
};
const registered = new Set<string>();
const supported = new Set(["5.20260918.0-alpha", "5.20260921.0-alpha"]);

const loadMiniflare = (path: string, undici: string) => {
  const source = readFileSync(path, "utf8");
  if (
    (source.match(/require\("undici"\)/g)?.length ?? 0) !== 9 ||
    !source.includes("module.exports = __toCommonJS(src_exports)")
  )
    throw new Error("Cloudflare build transport has an unsupported Miniflare module shape.");
  const require = createRequire(path);
  const localRequire = Object.assign(
    (specifier: string) => require(specifier === "undici" ? undici : specifier),
    require,
  );
  const module = { exports: {} as Record<string, unknown> };
  compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], {
    filename: path,
  })(module.exports, localRequire, module, path, dirname(path));
  return module.exports;
};

/** Bun's builtin undici ignores dispatchers. Only the official build runtime needs this bridge. */
export const initializeCloudflareTransport = () => {
  if (!process.versions.bun) return;
  const bun = (globalThis as typeof globalThis & { Bun: Loader }).Bun;
  const owners = [import.meta.url, createRequire(import.meta.url).resolve("@astrojs/cloudflare")];
  for (const owner of owners) {
    const plugin = createRequire(owner).resolve("@cloudflare/vite-plugin/package.json");
    const require = createRequire(plugin);
    const path = realpathSync(require.resolve("miniflare"));
    if (registered.has(path)) continue;
    const version = require("miniflare/package.json").version as string;
    if (!supported.has(version))
      throw new Error(
        `Cloudflare build transport needs compatibility verification for Miniflare ${version}.`,
      );
    const undici = createRequire(path).resolve("undici/index.js");
    bun.plugin({
      name: "renkin:cloudflare-build-transport",
      setup(builder) {
        const filter = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        builder.onLoad({ filter }, () => ({
          loader: "object",
          exports: loadMiniflare(path, undici),
        }));
      },
    });
    // Finish Bun's object-loader evaluation before the Vite plugin's ESM import
    // races Wrangler's CommonJS require. Otherwise require can receive partial exports.
    require(path);
    registered.add(path);
  }
};
