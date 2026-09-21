import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Effect } from "effect";
import { type Browser, chromium } from "playwright";
import { defineStack, development, type WorkerBuildResult } from "renkin";
import { worker } from "renkin/cloudflare";
import { buildTanStack } from "renkin/vite";
import { site } from "../../resources.ts";
import { createBuildProbe } from "./build-probe.ts";

const inspectBrowser = async (browser: Browser, url: string) => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole("button", { name: "Clicks: 0" }).click();
  await page.getByRole("button", { name: "Clicks: 1" }).waitFor();
  await page.getByRole("link", { name: "Details", exact: true }).click();
  await page.getByRole("heading", { name: "SSR details" }).waitFor();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.locator("#native-value").filter({ hasText: "stage: development" }).waitFor();
  await page.getByRole("link", { name: "Details", exact: true }).click();
  await page.getByRole("heading", { name: "SSR details" }).waitFor();
  assert.deepEqual(errors, []);
  return page;
};

const inspectBuild = async (build: WorkerBuildResult) => {
  assert.ok((build.modules?.length ?? 0) > 0);
  assert.ok(build.assets);
  const clientFiles = await readdir(build.assets.directory, { recursive: true });
  assert.ok(clientFiles.some((name) => name.endsWith(".map")));
  const clientCode = await Promise.all(
    clientFiles
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFile(resolve(build.assets?.directory ?? "", name), "utf8")),
  );
  assert.ok(clientCode.some((source) => source.includes("Solid SSR example")));
};

const check = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "renkin-ssr-"));
  const detail = resolve(site.website.root, "src/routes/details.tsx");
  const original = await readFile(detail, "utf8");
  const previousPolling = process.env.RENKIN_TEST_POLLING;
  process.env.RENKIN_TEST_POLLING = "true";
  const browser = await chromium.launch({ headless: true });
  const probe = await createBuildProbe(site);
  const declared = probe.site;
  const run = (resource: ReturnType<typeof worker>, check: (url: string) => Promise<void>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const app = yield* development(
            defineStack({ name: "example-ssr-test", resources: [resource] }),
            { directory },
          );
          const active = app.workers.Site;
          if (!active) throw Error("Missing Site");
          yield* Effect.promise(() => check(active.url));
        }),
      ),
    );
  try {
    await run(declared, async (url) => {
      const page = await inspectBrowser(browser, url);
      await writeFile(detail, original.replace("SSR details", "SSR live reload"));
      await page.getByRole("heading", { name: "SSR live reload" }).waitFor();
      const changed = await fetch(new URL("/api/counter", url), { method: "POST" });
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { value: 1 });
      assert.match(await (await fetch(new URL("/health.txt", url))).text(), /static asset/);
      await page.close();
    });
    await writeFile(detail, original);
    const build = await buildTanStack(declared);
    probe.verify();
    await inspectBuild(build);
    const { builder: _builder, ...options } = declared.options;
    await run(worker("Site", { ...options, build }), async (url) => {
      const page = await inspectBrowser(browser, url);
      const value = await (await fetch(new URL("/api/counter", url))).json();
      assert.deepEqual(value, { value: 1, stage: "development" });
      const response = await fetch(url);
      assert.equal(response.headers.get("x-renkin-example-entry"), "custom");
      assert.match(await response.text(), /Stored count:/);
      await page.close();
    });
  } finally {
    await writeFile(detail, original);
    await browser.close();
    await probe.close();
    await rm(directory, { recursive: true, force: true });
    if (previousPolling === undefined) delete process.env.RENKIN_TEST_POLLING;
    else process.env.RENKIN_TEST_POLLING = previousPolling;
  }
};
await check();
