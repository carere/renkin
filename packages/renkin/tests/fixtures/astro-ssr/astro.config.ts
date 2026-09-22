import { defineConfig } from "astro/config";
import { renkin } from "renkin/astro";
import { site } from "./renkin.ts";
export default defineConfig({
  site: "https://example.test",
  trailingSlash: "never",
  integrations: [renkin(site)],
});
