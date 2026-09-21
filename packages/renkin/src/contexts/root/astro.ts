import type { AstroResource } from "@renkin/websites/models/astro";

/** Builds the declared site, including its native binding metadata, without provisioning resources. */
export const buildAstro = (site: AstroResource) => {
  if (!site.options.builder) throw new Error("Astro resource has no build recipe.");
  return site.options.builder.build();
};
export type { AstroOptions, AstroResource } from "@renkin/websites/models/astro";
export type { AstroBuildOptions } from "@renkin/websites/models/astro-options";

export { renkin } from "@renkin/websites/services/astro/integration";
