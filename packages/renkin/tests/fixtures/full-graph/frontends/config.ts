import { fileURLToPath } from "node:url";
import { tanstackStart } from "renkin/cloudflare";
import { workerReference } from "renkin/worker";
import { Files, UploadToken } from "../shared/resources.ts";

// Vite imports only build/resource bindings, never the cron-containing infrastructure module.
export const frontend = (id: string, directory: string, rendering: "spa" | "ssr") =>
  tanstackStart(id, {
    root: fileURLToPath(new URL(`./${directory}/`, import.meta.url)),
    rendering,
    reuse: { inputs: ["../shared", "../config.ts", "../../shared"] },
    compatibilityDate: "2026-07-30",
    bindings: {
      API: workerReference("API"),
      AUTH: workerReference("Auth"),
      TRACKING: workerReference("Tracking"),
      Files,
      UploadToken,
    },
  });
