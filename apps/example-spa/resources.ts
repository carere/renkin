import { kv, tanstackStart } from "renkin/cloudflare";

const data = kv("Data");
export const site = tanstackStart("Site", {
  root: import.meta.dirname,
  rendering: "spa",
  compatibilityDate: "2026-07-30",
  port: 3101,
  bindings: { DATA: data, STAGE: "development" },
  buildEnvironment: { VITE_APPLICATION: "Solid SPA example" },
  sourceMap: true,
});
