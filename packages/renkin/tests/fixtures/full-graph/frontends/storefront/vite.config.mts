import { renkin } from "renkin/vite";
import { defineConfig } from "vite";
import { frontend } from "../config.ts";
export default defineConfig({
  plugins: [renkin(frontend("Storefront", "storefront", "ssr"))],
  server: { watch: { usePolling: process.env.RENKIN_GRAPH_POLLING === "true", interval: 100 } },
});
