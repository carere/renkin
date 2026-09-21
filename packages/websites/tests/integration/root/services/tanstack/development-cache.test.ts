import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "@effect/vitest";
import type { WorkerDevelopmentSession } from "@renkin/runtime/models/worker-builder";
import { startLocalGraph } from "@renkin/runtime/services/local/local-graph-service";
import { tanstackStart } from "#src/contexts/root/models/tanstack.ts";

it("keeps request bindings alive during Vite cache writes while still watching Worker artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-cache-watch-"));
  let session: WorkerDevelopmentSession | undefined;
  let graph: Awaited<ReturnType<typeof startLocalGraph>> | undefined;
  try {
    const root = join(directory, "application");
    const working = join(directory, "session");
    await mkdir(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Cache boundary</title>");
    const site = tanstackStart("site", {
      root,
      rendering: "ssr",
      compatibilityDate: "2026-07-30",
      bindings: { DATA: { type: "cloudflare.kv", id: "data" } },
    });
    const develop = site.options.builder?.develop;
    if (!develop) throw Error("Missing framework development recipe");
    session = await develop({ directory: working, watch: true });
    let notifyReload!: () => void;
    const reloaded = new Promise<void>((resolve) => {
      notifyReload = resolve;
    });
    graph = await startLocalGraph({
      workers: [{ id: "site", build: session.build, compatibilityDate: "2026-07-30" }],
      namespaces: { data: "native-data" },
      persist: join(directory, "persist"),
      watch: true,
      onReload: notifyReload,
    });
    const binding = (await graph.bindings("site")).DATA as {
      put(key: string, value: string): Promise<void>;
      get(key: string): Promise<string | null>;
    };
    await binding.put("request", "alive");
    // Model an SSR request holding its native KV handle while the optimizer writes.
    const cache = join(working, "vite/deps");
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "_metadata.json"), "{}");
    const unexpectedReload = await Promise.race([reloaded.then(() => true), delay(500, false)]);
    expect(await binding.get("request")).toBe("alive");
    expect(unexpectedReload).toBe(false);
    // Positive control: the real forwarding artifact must still trigger a graph reload.
    const entry = join(dirname(session.build.entry), "development-worker.mjs");
    await writeFile(entry, `${await readFile(entry, "utf8")}\n// changed artifact\n`);
    expect(await Promise.race([reloaded.then(() => true), delay(3000, false)])).toBe(true);
  } finally {
    await session?.close();
    await graph?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
