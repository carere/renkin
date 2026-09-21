import { writeFile } from "node:fs/promises";
import { buildAstro } from "renkin/astro";
import { site } from "./renkin.ts";

const result = await buildAstro(site);
await writeFile(
  new URL("./.renkin/build-result.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
