import { renkin } from "renkin/vite";
import { defineConfig } from "vite";
import { site } from "./resources.ts";
export default defineConfig({
  // Discover Query's core before cold browser requests can receive stale dependency hashes.
  optimizeDeps: { include: ["@tanstack/solid-query > @tanstack/query-core"] },
  plugins: [renkin(site)],
  ...(process.env.RENKIN_TEST_POLLING
    ? { server: { watch: { usePolling: true, interval: 100 } } }
    : {}),
});
