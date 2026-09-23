import { kv, tanstackStart } from "@carere/renkin/cloudflare";

const data = kv("Data");
export const site = tanstackStart("Site", {
  root: import.meta.dirname,
  rendering: "ssr",
  compatibilityDate: "2026-07-30",
  port: 3102,
  bindings: { DATA: data, STAGE: "development" },
  buildEnvironment: { VITE_APPLICATION: "Solid SSR example" },
  sourceMap: true,
  serverEntry: "./src/server.ts",
});
