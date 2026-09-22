import { defineStack, output } from "renkin";
import { worker } from "renkin/cloudflare";

export default defineStack({
  name: "example-worker",
  resources: [
    worker("api", {
      entry: new URL("./effect.ts", import.meta.url).pathname,
      compatibilityDate: "2026-07-30",
      port: 8787,
    }),
  ],
  outputs: { message: output("hello"), secret: output("hidden", { secret: true }) },
});
