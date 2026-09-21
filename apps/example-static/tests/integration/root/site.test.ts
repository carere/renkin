import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { type Browser, chromium } from "playwright";
import { defineStack, development } from "renkin";
import { buildAstro } from "renkin/astro";
import { worker } from "renkin/cloudflare";
import { site } from "../../../renkin.ts";

const navigateAbout = async (browser: Browser, url: string) => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const navigations: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) {
      navigations.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  try {
    expect((await page.goto(url))?.status()).toBe(200);
    const link = page.getByRole("link", { name: "See the second route →" });
    expect(await link.getAttribute("href")).toBe("/about/");
    await Promise.all([page.waitForURL((url) => /^\/about\/?$/.test(url.pathname)), link.click()]);
    await page.getByRole("heading", { name: "Static, with no session namespace." }).waitFor();
    expect(errors).toEqual([]);
  } catch (cause) {
    throw new Error(
      `Static navigation failed: ${JSON.stringify({
        url: page.url(),
        navigations,
        errors,
        headings: await page.getByRole("heading").allTextContents(),
      })}`,
      { cause },
    );
  } finally {
    await page.close();
  }
};

it.effect(
  "builds and serves the public static example without session storage",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "renkin-static-example-"));
      const browser = await chromium.launch({ headless: true });
      try {
        const build = await buildAstro(site);
        const { builder: _builder, ...options } = site.options;
        expect(site.sessionKV).toBeUndefined();
        expect(site.dependencies).toEqual([]);
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const local = yield* development(
                defineStack({
                  name: "static-example",
                  resources: [worker(site.id, { ...options, build })],
                }),
                { directory, watch: false },
              );
              const running = local.workers.static;
              if (!running) throw new Error("Static example is missing.");
              const home = yield* Effect.promise(() => running.fetch("/"));
              expect(home.status).toBe(200);
              expect(home.headers.get("x-renkin-example")).toBe("astro-static");
              expect(yield* Effect.promise(() => home.text())).toContain('data-runtime="function"');
              const about = yield* Effect.promise(() => running.fetch("/about/"));
              expect(about.status).toBe(200);
              expect(yield* Effect.promise(() => about.text())).toContain(
                "Static, with no session namespace.",
              );
              expect((yield* Effect.promise(() => running.fetch("/missing"))).status).toBe(404);
              yield* Effect.promise(() => navigateAbout(browser, running.url));
            }),
          ),
        );
      } finally {
        await browser.close();
        await rm(directory, { recursive: true, force: true });
      }
    }),
  60_000,
);
