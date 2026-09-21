import { renkin } from "renkin/vite";
import { defineConfig } from "vite";
import { frontend } from "../config.ts";
export default defineConfig({
  optimizeDeps: { include: ["@tanstack/solid-query > @tanstack/query-core"] },
  plugins: [renkin(frontend("CustomerHub", "customer-hub", "spa"))],
  server: { watch: { usePolling: process.env.RENKIN_GRAPH_POLLING === "true", interval: 100 } },
});
