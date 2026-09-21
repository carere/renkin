import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  astroRead,
  astroUrl,
  createCloudAstroFixture,
} from "../../support/root/cloud-astro-fixture.ts";

const sessionCounts = async (url: string) => {
  let cookie = "";
  for (let count = 1; count <= 2; count++) {
    const response = await fetch(new URL("/session", url), {
      headers: { cookie },
      signal: AbortSignal.timeout(20_000),
    });
    expect(response.status).toBe(200);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    expect(await response.text()).toContain(`data-count="${count}"`);
  }
};

it.effect(
  "deploys Astro static and SSR with domains, native bindings, session variants and exact cleanup",
  () =>
    Effect.promise(async () => {
      const fixture = createCloudAstroFixture();
      let completed = false;
      try {
        const first = await fixture.apply("auto");
        process.stdout.write("Astro automatic session deployment complete.\n");
        expect(
          Object.values(first.resources)
            .filter((resource) => resource.definition.type === "cloudflare.kv")
            .map((resource) => resource.definition.id)
            .sort(),
        ).toEqual(["content", "ssr-session"]);
        const staticUrl = astroUrl(first, "static");
        const ssrUrl = astroUrl(first, "ssr");
        const home = await astroRead(staticUrl, 'data-runtime="function"');
        expect(home.response.headers.get("x-renkin-example")).toBe("astro-static");
        await astroRead(new URL("/about/", staticUrl).href, "Static, with no session namespace.");
        process.stdout.write("Astro static workers.dev routes passed.\n");
        await astroRead(
          `https://${fixture.hostname}/about/`,
          "Static, with no session namespace.",
          180_000,
        );
        process.stdout.write("Astro custom hostname passed.\n");
        await astroRead(new URL("/?name=Cloud", ssrUrl).href, "Hello, Cloud.");
        expect(JSON.parse((await astroRead(new URL("/api/content", ssrUrl).href)).body)).toEqual({
          message: "Native KV is connected.",
        });
        const generated = await astroRead(
          new URL("/generated", ssrUrl).href,
          'data-runtime="function"',
        );
        expect(generated.body).toContain('data-content="undefined"');
        await sessionCounts(ssrUrl);
        process.stdout.write("Astro native SSR/session checks passed.\n");
        const existing = await fixture.apply("existing");
        process.stdout.write("Astro existing session deployment complete.\n");
        expect(existing.resources.ssr?.physicalId).toBe(first.resources.ssr?.physicalId);
        expect(existing.resources["ssr-session"]).toBeUndefined();
        expect(existing.resources.visits?.definition.type).toBe("cloudflare.kv");
        await astroRead(ssrUrl, "Astro cloud existing");
        await sessionCounts(ssrUrl);
        const disabled = await fixture.apply("disabled");
        process.stdout.write("Astro disabled session deployment complete.\n");
        expect(disabled.resources.visits?.physicalId).toBe(existing.resources.visits?.physicalId);
        expect(disabled.resources["ssr-session"]).toBeUndefined();
        await astroRead(ssrUrl, "Astro cloud disabled");
        expect(
          JSON.parse((await astroRead(new URL("/api/session-status", ssrUrl).href)).body),
        ).toEqual({ enabled: false });
        completed = true;
      } finally {
        await fixture.close();
      }
      expect(completed).toBe(true);
      expect(await fixture.list()).toEqual([]);
    }),
  660_000,
);
