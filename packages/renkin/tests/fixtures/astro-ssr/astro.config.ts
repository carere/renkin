import { renkin } from "@carere/renkin/astro";
import { defineConfig } from "astro/config";
import { site } from "./renkin.ts";
export default defineConfig({
  site: "https://example.test",
  trailingSlash: "never",
  integrations: [renkin(site)],
});
