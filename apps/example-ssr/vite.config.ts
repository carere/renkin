import { renkin } from "renkin/vite";
import { defineConfig } from "vite";
import { site } from "./resources.ts";
export default defineConfig({
  plugins: [renkin(site)],
  ...(process.env.RENKIN_TEST_POLLING
    ? { server: { watch: { usePolling: true, interval: 100 } } }
    : {}),
});
