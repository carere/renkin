import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineStack, deploy, removeEnvironment } from "@carere/renkin";
import { customDomain, kv, tanstackStart } from "@carere/renkin/cloudflare";
import { Effect } from "effect";

const scope = () => {
  const prefix = process.env.RENKIN_CLOUDFLARE_TEST_PREFIX;
  const domain = process.env.RENKIN_CLOUDFLARE_TEST_DOMAIN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (
    !prefix ||
    !domain ||
    !zoneId ||
    process.env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    process.env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    !(Date.parse(process.env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "") > Date.now())
  )
    throw new Error(
      "TanStack cloud tests require current prefix, domain and product authorization.",
    );
  return { prefix, domain, zoneId };
};
const ready = async (url: string, expected: string, timeout = 180_000) => {
  let status = "not requested";
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
      });
      status = `HTTP ${response.status}`;
      if (response.ok && (await response.text()).includes(expected)) return;
    } catch (error) {
      status = error instanceof Error ? error.name : "network error";
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Framework readiness failed: ${url}; ${status}`);
};
const verify = async (url: string, mode: string) => {
  const first = await fetch(new URL("/api/counter", url), { method: "POST" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { value: 1 });
  const value = await fetch(new URL("/api/counter", url));
  assert.deepEqual(await value.json(), { value: 1, stage: "cloud-acceptance" });
  assert.match(await (await fetch(new URL("/health.txt", url))).text(), /static asset/);
  const page = await fetch(url);
  const html = await page.text();
  assert.match(html, /Renkin Solid/);
  const asset = html.match(/(?:src|href)="([^"]+\.js)"/)?.[1];
  assert.ok(asset, "Built page must reference a client JavaScript asset");
  const javascript = await fetch(new URL(asset, url));
  assert.equal(javascript.status, 200);
  assert.match(javascript.headers.get("content-type") ?? "", /javascript/);
  if (mode === "ssr") {
    assert.equal(page.headers.get("x-renkin-example-entry"), "custom");
    assert.match(html, /cloud-acceptance/);
  } else {
    const fallback = await fetch(new URL("/client-only-path", url), {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
    });
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /Renkin Solid/);
  }
};
const traceGateway = () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname !== "/v1/mutate") return original(request);
    const payload = (await request.clone().json()) as { request?: { path?: string } };
    const response = await original(request);
    try {
      if (!response.ok) console.info(`Gateway HTTP ${response.status}: ${payload.request?.path}`);
      else {
        const result = (await response.clone().json()) as { status: number; bodyBase64: string };
        if (result.status >= 400) {
          const body = JSON.parse(Buffer.from(result.bodyBase64, "base64").toString()) as {
            errors?: { code: number; message?: string }[];
          };
          console.info(
            `Provider HTTP ${result.status}: ${payload.request?.path}; codes=${body.errors?.map((error) => error.code).join(",")}`,
          );
        }
      }
    } catch {
      /* Diagnostics must never change a completed mutation outcome. */
    }
    return response;
  };
  return () => {
    globalThis.fetch = original;
  };
};
const run = async () => {
  const authorized = scope();
  const mode = process.argv[2];
  if (mode !== "spa" && mode !== "ssr") throw new Error("Expected SPA or SSR scenario.");
  const root = resolve(import.meta.dirname, `../../../../../apps/example-${mode}`);
  const example = (await import(pathToFileURL(resolve(root, "resources.ts")).href)) as {
    site: ReturnType<typeof tanstackStart>;
  };
  const name = `${authorized.prefix}-${mode}-${randomUUID().slice(0, 8)}`;
  const hostname = `${name}.${authorized.domain}`;
  const site = tanstackStart("Site", {
    ...example.site.website,
    allowDelete: true,
    bindings: { DATA: kv("Data", { allowDelete: true }), STAGE: "cloud-acceptance" },
  });
  const stack = defineStack({
    name,
    resources: [
      site,
      ...(mode === "ssr"
        ? [customDomain("Domain", { worker: site, hostname, zoneId: authorized.zoneId })]
        : []),
    ],
  });
  const options = {
    environment: "framework",
    yes: true,
    cloudflare: { stateScriptName: `${authorized.prefix}-state-v2` },
    progress: ({ id, kind }: { id: string; kind: string }) =>
      console.info(`${mode} ${kind}: ${id}`),
  };
  console.info(
    `TanStack ownership: ${name}/framework${mode === "ssr" ? `; domain ${hostname}` : ""}`,
  );
  const restore = traceGateway();
  try {
    const result = await Effect.runPromise(deploy(stack, options));
    const output = result.resources.Site?.outputs as { url?: string } | undefined;
    assert.ok(output?.url);
    await ready(output.url, "Renkin Solid");
    await verify(output.url, mode);
    if (mode === "ssr") {
      // Custom-domain certificate issuance can remain pending after Worker readiness.
      await ready(`https://${hostname}`, "Renkin Solid", 900_000);
      const response = await fetch(`https://${hostname}/api/counter`);
      assert.deepEqual(await response.json(), { value: 1, stage: "cloud-acceptance" });
    }
    console.info(`TanStack ${mode} cloud rendering, bindings, assets and routing passed.`);
  } finally {
    try {
      scope();
      await Effect.runPromise(removeEnvironment(name, options));
      console.info(`TanStack cleanup completed: ${name}/framework`);
    } finally {
      restore();
    }
  }
};
await run();
