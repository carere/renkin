import { fileURLToPath } from "node:url";
import { defineStack } from "@carere/renkin";
import { astro } from "@carere/renkin/cloudflare";

export const site = astro("static", {
  root: fileURLToPath(new URL(".", import.meta.url)),
  output: "static",
  compatibilityDate: "2026-07-30",
});
export default defineStack({ name: "renkin-example-static", resources: [site] });
