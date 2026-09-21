import { resolve } from "node:path";
import type { Plugin, PluginOption } from "vite";
import type { TanStackResource } from "../../models/tanstack.ts";

/** Official framework plugins, configured once from the resource declaration. */
export const renkin = async (site: TanStackResource): Promise<PluginOption[]> => {
  const options = site.website;
  const [{ cloudflare }, { tanstackStart }, { default: solid }] = await Promise.all([
    import("@cloudflare/vite-plugin"),
    import("@tanstack/solid-start/plugin/vite"),
    import("vite-plugin-solid"),
  ]);
  const production = cloudflare({
    config: {
      name: `renkin-${site.id.toLowerCase()}`,
      main: options.serverEntry
        ? resolve(options.root, options.serverEntry)
        : "@tanstack/solid-start/server-entry",
      compatibility_date: options.compatibilityDate,
      compatibility_flags: [...(options.compatibilityFlags ?? ["nodejs_compat"])],
    },
    viteEnvironment: { name: "ssr" },
    remoteBindings: false,
    inspectorPort: false,
    persistState: false,
  });
  const configuration: Plugin = {
    name: "renkin:tanstack",
    api: { rendering: options.rendering },
    config: (configuration) => ({
      root: options.root,
      server: {
        host: "127.0.0.1",
        ...(options.port === undefined
          ? {}
          : { port: configuration.server?.port ?? options.port, strictPort: true }),
      },
      ssr: { noExternal: ["@tanstack/solid-router"] },
      build: { ...(options.sourceMap === undefined ? {} : { sourcemap: options.sourceMap }) },
    }),
  };
  return [
    configuration,
    ...production.map(
      (plugin): Plugin => ({
        ...plugin,
        apply: (configuration, environment) => {
          if (environment.command !== "build" && !environment.isPreview) return false;
          if (typeof plugin.apply === "function") return plugin.apply(configuration, environment);
          return !plugin.apply || plugin.apply === environment.command;
        },
      }),
    ),
    tanstackStart({
      ...(options.serverEntry ? { server: { entry: options.serverEntry } } : {}),
      ...(options.rendering === "spa"
        ? { spa: { enabled: true, prerender: { outputPath: "/index.html" } } }
        : {}),
    }),
    solid({ ssr: true }),
  ];
};
