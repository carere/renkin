import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import {
  readCliResponse,
  startCli,
  waitForCliReload,
  waitForCliUrl,
} from "#test-support/root/services/cli-process/cli-process.ts";

it("one Bun command serves and watches an application with no credentials", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(process.cwd(), ".renkin-dev-"));
  const entry = join(directory, "worker.ts");
  const infra = join(directory, "renkin.ts");
  let cli: ReturnType<typeof startCli> | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = () =>
    (cleaning ??= (async () => {
      try {
        await cli?.stop();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    })());
  onTestFinished(cleanup);
  try {
    await writeFile(entry, 'export default { fetch() { return new Response("first") } }');
    await writeFile(
      infra,
      `import {defineStack} from "@carere/renkin";import {worker} from "@carere/renkin/cloudflare";export default defineStack({name:"cli-test",resources:[worker("api",{entry:${JSON.stringify(entry)},port:0,compatibilityDate:"2026-07-30"})]});`,
    );
    if (cleaning) throw new Error("CLI setup: test finished before spawn.");
    cli = startCli(
      [
        "--no-env-file",
        fileURLToPath(new URL("../../../../src/contexts/root/cli/main.ts", import.meta.url)),
        "dev",
        "--file",
        infra,
        "--state-dir",
        join(directory, "state"),
      ],
      directory,
    );
    const url = await waitForCliUrl(cli, 15_000);
    expect(await readCliResponse(url, "initial request", 3_000)).toBe("first");
    await writeFile(entry, 'export default { fetch() { return new Response("second") } }');
    expect(await waitForCliReload(cli, url, "second", 10_000)).toBe("second");
  } finally {
    await cleanup();
  }
  // Startup 15s + first request 3s + reload 10s + cleanup 5s, with setup margin.
}, 40_000);
