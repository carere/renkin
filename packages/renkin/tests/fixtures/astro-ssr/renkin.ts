import { fileURLToPath } from "node:url";
import { defineStack } from "renkin";
import { astro, kv } from "renkin/cloudflare";

const content = kv("content");
export const site = astro("website", {
  root: fileURLToPath(new URL(".", import.meta.url)),
  output: "server",
  compatibilityDate: "2026-07-30",
  bindings: { CONTENT: content, GREETING: "Renkin on Cloudflare" },
});
export default defineStack({ name: "renkin-website", resources: [site] });
