import { buildAstro as build } from "@renkin/websites/services/astro/build-astro";
import { developAstro as develop } from "@renkin/websites/services/astro/develop-astro";
export const buildAstro = build;
export const developAstro = develop;
export type { AstroOptions, AstroResource } from "@renkin/websites/models/astro";
export type { AstroBuildOptions } from "@renkin/websites/models/astro-options";
