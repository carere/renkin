import type { TanStackResource } from "@renkin/websites/models/tanstack";
import { renkin as plugin } from "@renkin/websites/services/tanstack/vite-plugin";
export const renkin = plugin;
/** Build the declared site, including its inferred native binding metadata. */
export const buildTanStack = (site: TanStackResource) => {
  const recipe = site.options.builder;
  if (!recipe) throw new Error("TanStack site has no build recipe.");
  return recipe.build();
};
