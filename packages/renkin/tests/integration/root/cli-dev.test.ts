import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect(
  "one Bun command serves and watches an application with no credentials",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(join(process.cwd(), ".renkin-dev-"));
      const entry = join(directory, "worker.ts");
      const infra = join(directory, "renkin.ts");
      await writeFile(entry, 'export default { fetch() { return new Response("first") } }');
      await writeFile(
        infra,
        `import {defineStack} from "renkin";import {worker} from "renkin/cloudflare";export default defineStack({name:"cli-test",resources:[worker("api",{entry:${JSON.stringify(entry)},port:0,compatibilityDate:"2026-07-30"})]});`,
      );
      const cli = new URL("../../../src/contexts/root/cli/main.ts", import.meta.url).pathname;
      const child = spawn(
        process.versions.bun ? process.execPath : "bun",
        [cli, "dev", "--file", infra, "--state-dir", join(directory, "state")],
        {
          cwd: directory,
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      child.stderr.on("data", (chunk) => {
        log += String(chunk);
      });
      try {
        let url: string | undefined;
        for (let attempt = 0; attempt < 60; attempt++) {
          url = /http:\/\/127\.0\.0\.1:\d+\//.exec(log)?.[0];
          if (url) break;
          if (child.exitCode !== null) throw new Error("Local command exited before startup.");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!url) throw new Error("Local command did not start.");
        expect(await (await fetch(url)).text()).toBe("first");
        await writeFile(entry, 'export default { fetch() { return new Response("second") } }');
        for (let attempt = 0; attempt < 30; attempt++) {
          if (
            (await fetch(url)
              .then((response) => response.text())
              .catch(() => "")) === "second"
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(await (await fetch(url)).text()).toBe("second");
      } finally {
        const closed = once(child, "close");
        child.kill("SIGTERM");
        await closed;
        await rm(directory, { recursive: true, force: true });
      }
    }),
  15_000,
);
