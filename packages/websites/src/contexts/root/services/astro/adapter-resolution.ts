import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Resolve the adapter's virtual entrypoints from its owning dependency, including isolated installs. */
export const adapterResolution = (): Plugin => ({
  name: "renkin:astro-adapter-resolution",
  enforce: "pre",
  resolveId(source) {
    if (source.startsWith("/@astrojs/cloudflare/")) source = source.slice(1);
    if (source === "@astrojs/cloudflare" || source.startsWith("@astrojs/cloudflare/"))
      return fileURLToPath(import.meta.resolve(source));
  },
});
