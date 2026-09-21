import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { startLocalWorker } from "../../../src/contexts/root/services/local/local-worker-service.ts";

it.effect("serves a real Worker and reloads changed implementation without credentials", () =>
  Effect.promise(async () => {
    const directory = await mkdtemp(join(tmpdir(), "renkin-worker-"));
    const entry = join(directory, "worker.ts");
    await writeFile(entry, 'export default { fetch() { return new Response("first") } }');
    const worker = await startLocalWorker({ entry, compatibilityDate: "2026-07-30", watch: true });
    try {
      expect(await (await worker.fetch("/hello")).text()).toBe("first");
      await writeFile(entry, 'export default { fetch() { return new Response("second") } }');
      for (let attempt = 0; attempt < 30; attempt++) {
        if (
          (await worker
            .fetch()
            .then((response) => response.text())
            .catch(() => "")) === "second"
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await (await worker.fetch()).text()).toBe("second");
    } finally {
      await worker.close();
      await rm(directory, { recursive: true, force: true });
    }
  }),
);
