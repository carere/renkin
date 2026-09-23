import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineStack,
  deploy,
  readOutputs,
  removeEnvironment,
  type WorkerBuildResult,
} from "@carere/renkin";
import {
  accessApplication,
  accessPolicy,
  accessServiceToken,
  customDomain,
  observabilityDestination,
  worker,
} from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  closedTransport,
  navigation,
  siteFetch,
  traceStateCalls,
} from "#test-support/root/site-http.ts";

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
    throw new Error("Protected-site cloud tests require current domain and product authorization.");
  return { prefix, domain, zoneId };
};
const waitFor = async (check: () => Promise<boolean>, label: string) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Cloud propagation timed out: ${label}`);
};
const object = (value: unknown) => value as Record<string, unknown>;
const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
        ...init.headers,
      },
    },
  );
  const result = (await response.json()) as {
    success: boolean;
    result: unknown;
    errors?: { code: number }[];
  };
  if (!response.ok || !result.success)
    throw new Error(
      `Cloud verification ${init.method ?? "GET"} ${path}: ${response.status} codes ${result.errors?.map((error) => error.code).join(",")}`,
    );
  return result.result;
};
const setup = async () => {
  const authorized = scope();
  const name =
    process.env.RENKIN_SITE_TEST_NAME ?? `${authorized.prefix}-site-${randomUUID().slice(0, 8)}`;
  if (!name.startsWith(`${authorized.prefix}-site-`))
    throw new Error("Test name is outside the authorized prefix.");
  const directory = await mkdtemp(join(tmpdir(), "renkin-site-"));
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "site.mjs"),
    "export default {fetch(){return new Response('api')}}",
  );
  await writeFile(join(directory, "assets/index.html"), "<h1>protected-one</h1>");
  await writeFile(
    join(directory, "sink.ts"),
    "export default {fetch(){return new Response('{}',{headers:{'content-type':'application/json'}})}}",
  );
  const stateScriptName =
    process.env.RENKIN_SITE_TEST_STATE_NAME ?? `${name}-state-${randomUUID().slice(0, 6)}`;
  if (!stateScriptName.startsWith(`${name}-state-`))
    throw new Error("State name is outside the test scope.");
  const options = { environment: "cloud", yes: true, cloudflare: { stateScriptName } };
  const hostname = `${name}.${authorized.domain}`;
  const build: WorkerBuildResult = {
    entry: join(directory, "site.mjs"),
    assets: {
      directory: join(directory, "assets"),
      config: { notFoundHandling: "single-page-application" },
    },
    compatibilityDate: "2026-08-01",
  };
  console.info(
    `Protected site ownership: ${name}, ${name}-sink, ${name}-traces; domain ${hostname}; isolated backend ${stateScriptName}`,
  );
  return { ...authorized, name, directory, hostname, build, options };
};
type Scenario = Awaited<ReturnType<typeof setup>>;
const prepareObservability = async (test: Scenario) => {
  const sink = await Effect.runPromise(
    deploy(
      defineStack({
        name: `${test.name}-sink`,
        resources: [
          worker("sink", {
            entry: join(test.directory, "sink.ts"),
            compatibilityDate: "2026-08-01",
          }),
        ],
      }),
      test.options,
    ),
  );
  const url = String(object(sink.resources.sink?.outputs).url);
  await waitFor(async () => (await fetch(url)).ok, "observability sink");
  const destination = observabilityDestination("traces", {
    name: test.name,
    url,
    logpushDataset: "opentelemetry-traces",
    headers: { "x-renkin-test": "one" },
    enabled: true,
  });
  const stack = defineStack({ name: `${test.name}-traces`, resources: [destination] });
  const result = await Effect.runPromise(deploy(stack, test.options));
  return {
    url,
    slug: String(object(result.resources.traces?.outputs).slug),
    id: result.resources.traces?.physicalId,
  };
};
const siteStack = (test: Scenario, slug: string, update = false) => {
  const token = accessServiceToken("token", { name: "site-test", duration: "1h" });
  const otherToken = accessServiceToken("other-token", {
    name: "isolated-site-test",
    duration: "1h",
  });
  const policy = accessPolicy("service", {
    name: "site-service",
    decision: "non_identity",
    serviceTokens: [token],
  });
  const app = accessApplication("access", {
    name: "site",
    domain: test.hostname,
    policies: [policy],
    ...(update
      ? { corsHeaders: { allowedHeaders: ["x-updated"] } }
      : {
          eagerRedirectCookieSetting: true,
          corsHeaders: {
            allowCredentials: true,
            allowedMethods: ["GET", "OPTIONS"],
            allowedHeaders: ["x-test"],
            allowedOrigins: [`https://frontend.${test.hostname}`],
          },
        }),
  });
  const site = worker("site", {
    build: test.build,
    compatibilityDate: "2026-08-01",
    workersDev: false,
    dependencies: [app],
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: false, destinations: [] },
      traces: { enabled: true, headSamplingRate: 1, persist: true, destinations: [slug] },
    },
  });
  return defineStack({
    name: test.name,
    resources: [
      token,
      otherToken,
      policy,
      app,
      site,
      customDomain("domain", {
        hostname: test.hostname,
        zoneId: test.zoneId,
        worker: site,
        access: app,
      }),
    ],
  });
};
const verifySite = async (test: Scenario, slug: string) => {
  const first = await deployAfterLostTokenReply(test, slug);
  const headers = await verifyAccess(test, first.resources);
  await writeFile(join(test.directory, "assets/index.html"), "<h1>protected-two</h1>");
  const second = await Effect.runPromise(deploy(siteStack(test, slug, true), test.options));
  expect(second.resources.site?.physicalId).toBe(first.resources.site?.physicalId);
  expect(second.resources.token?.physicalId).toBe(first.resources.token?.physicalId);
  const observed = object(await api(`/access/apps/${second.resources.access?.physicalId}`));
  expect(observed.eager_redirect_cookie_setting).toBe(true);
  expect(observed.cors_headers).toMatchObject({
    allow_credentials: true,
    allowed_headers: ["x-updated"],
    allowed_origins: [`https://frontend.${test.hostname}`],
  });
  const settings = object(
    await api(`/workers/scripts/${second.resources.site?.physicalId}/settings`),
  );
  expect(settings.observability).toMatchObject({
    redact_query_string: true,
    traces: { destinations: [slug], head_sampling_rate: 1 },
  });
  await waitFor(
    async () =>
      (await navigation(`https://${test.hostname}/nested`, headers)).includes("protected-two"),
    "updated SPA fallback",
  );
};
const deployAfterLostTokenReply = async (test: Scenario, slug: string) => {
  const original = globalThis.fetch;
  let droppedId: string | undefined;
  let tokenCalls = 0;
  let failureDescription = "none";
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname !== "/v1/mutate") return original(request);
    const payload = (await request.clone().json()) as {
      request?: { path?: string; receiptOnly?: boolean };
    };
    const response = await original(request);
    if (!response.ok)
      console.info(`Gateway failure: status=${response.status}; path=${payload.request?.path}`);
    if (payload.request?.path?.endsWith("/access/service_tokens")) {
      tokenCalls++;
      console.info(
        `Token gateway: receiptOnly=${payload.request.receiptOnly === true}; outerStatus=${response.status}`,
      );
    }
    if (
      !droppedId &&
      !payload.request?.receiptOnly &&
      payload.request?.path?.endsWith("/access/service_tokens") &&
      response.ok
    ) {
      const result = (await response.clone().json()) as { status: number; bodyBase64: string };
      if (result.status >= 200 && result.status < 300) {
        const body = JSON.parse(Buffer.from(result.bodyBase64, "base64").toString()) as {
          result?: { id?: string };
        };
        if (body.result?.id) {
          droppedId = body.result.id;
          throw new TypeError("Simulated lost reply after a one-time token was created.");
        }
      }
    }
    return response;
  };
  let failed = false;
  try {
    await Effect.runPromise(deploy(siteStack(test, slug), test.options));
  } catch (error) {
    failed = true;
    failureDescription = error instanceof Error ? error.message : "unknown";
    console.info(
      `Lost-reply first deployment: ${failureDescription}; tokenCalls=${tokenCalls}; dropped=${Boolean(droppedId)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
  if (!failed || !droppedId)
    throw new Error(
      `The token creation lost-reply boundary was not exercised: calls=${tokenCalls}, failed=${failed}, error=${failureDescription}`,
    );
  const recovered = await Effect.runPromise(deploy(siteStack(test, slug), test.options));
  expect(recovered.resources.token?.physicalId).toBe(droppedId);
  return recovered;
};
const cleanup = async (test: Scenario) => {
  for (const name of [test.name, `${test.name}-traces`, `${test.name}-sink`])
    await Effect.runPromise(removeEnvironment(name, test.options));
  const backend = object(
    await api(`/workers/scripts/${test.options.cloudflare.stateScriptName}/settings`),
  );
  if (!Array.isArray(backend.tags) || !backend.tags.includes("renkin-state-v2"))
    throw new Error("Refusing cleanup of an unverified test coordinator.");
  await api(`/workers/scripts/${test.options.cloudflare.stateScriptName}?force=true`, {
    method: "DELETE",
  });
  await rm(test.directory, { recursive: true, force: true });
};

it.live(
  "deploys, protects, observes, updates and removes an asset-backed custom domain",
  () =>
    Effect.promise(async () => {
      const test = await setup();
      const trace = traceStateCalls();
      const failures: unknown[] = [];
      try {
        const destination = await prepareObservability(test);
        await verifySite(test, destination.slug);
        const updated = await Effect.runPromise(
          deploy(
            defineStack({
              name: `${test.name}-traces`,
              resources: [
                observabilityDestination("traces", {
                  name: test.name,
                  url: destination.url,
                  logpushDataset: "opentelemetry-traces",
                  headers: { "x-renkin-test": "two" },
                  enabled: false,
                }),
              ],
            }),
            test.options,
          ),
        );
        expect(updated.resources.traces?.physicalId).toBe(destination.id);
        expect(updated.resources.traces?.outputs).toMatchObject({ enabled: false });
      } catch (error) {
        console.info(
          `Site scenario failed: ${error instanceof Error ? error.message : "unknown"}; stateTrace=${trace.events.join(" | ")}`,
        );
        failures.push(error);
      }
      try {
        await cleanup(test);
        console.info("Site resources and isolated coordinator removed.");
      } catch (error) {
        console.info(
          `Site cleanup failed: ${error instanceof Error ? error.message : "unknown"}; stateTrace=${trace.events.join(" | ")}`,
        );
        failures.push(error);
      } finally {
        trace.restore();
      }
      if (failures.length) throw new AggregateError(failures, "Protected-site validation failed.");
    }),
  1_200_000,
);

const waitForSite = async (test: Scenario, headers: Record<string, string>) => {
  let last = "";
  // Provider certificate validation may outlast Worker publication readiness.
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`https://${test.hostname}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
      });
      const body = await response.text();
      if (response.ok && body.includes("protected-one")) return;
      const status = `HTTP ${response.status}; type=${response.headers.get("content-type")}; redirect=${response.headers.get("location") ? new URL(response.headers.get("location") ?? "", response.url).hostname : "none"}; expectedAsset=${body.includes("protected-one")}; api=${body === "api"}`;
      if (status !== last) {
        console.info(`Site readiness: ${status}`);
        last = status;
      }
    } catch (error) {
      const status =
        error instanceof Error
          ? `${error.name}: ${"code" in error ? error.code : "network"}; cause=${error.cause instanceof Error && "code" in error.cause ? error.cause.code : "unknown"}`
          : "network";
      if (status !== last) {
        console.info(`Site readiness: ${status}`);
        last = status;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Protected site was not ready: ${last}`);
};

const verifyAccess = async (
  test: Scenario,
  resources: Readonly<Record<string, { outputs: unknown }>>,
) => {
  const token = object(resources.token?.outputs);
  expect(typeof token.clientId).toBe("string");
  expect(typeof token.clientSecret).toBe("string");
  const headers = {
    "CF-Access-Client-Id": String(token.clientId),
    "CF-Access-Client-Secret": String(token.clientSecret),
  };
  await waitForSite(test, headers);
  const unauthorized = await siteFetch(`https://${test.hostname}`, { redirect: "manual" });
  expect([302, 401, 403]).toContain(unauthorized.status);
  const otherToken = object(resources["other-token"]?.outputs);
  const isolated = await siteFetch(`https://${test.hostname}`, {
    redirect: "manual",
    headers: {
      "CF-Access-Client-Id": String(otherToken.clientId),
      "CF-Access-Client-Secret": String(otherToken.clientSecret),
    },
  });
  expect([302, 401, 403]).toContain(isolated.status);
  const alternateUrl = String(object(resources.site?.outputs).url);
  await verifyClosedOrigin(alternateUrl);
  const preflight = await siteFetch(`https://${test.hostname}`, {
    method: "OPTIONS",
    headers: {
      Origin: `https://frontend.${test.hostname}`,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "x-test",
    },
  });
  expect(preflight.headers.get("access-control-allow-origin")).toBe(
    `https://frontend.${test.hostname}`,
  );
  expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
  expect(preflight.headers.get("access-control-allow-methods")?.toUpperCase()).toContain("GET");
  expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-test");
  const foreignOrigin = "https://other-preview.example";
  const foreign = await siteFetch(`https://${test.hostname}`, {
    method: "OPTIONS",
    redirect: "manual",
    headers: {
      Origin: foreignOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "x-test",
    },
  });
  expect(foreign.headers.get("access-control-allow-origin")).not.toBe(foreignOrigin);
  expect(
    await Effect.runPromise(
      readOutputs(test.name, "cloud", { cloudflare: test.options.cloudflare }),
    ),
  ).toMatchObject({ token: "[REDACTED]" });
  return headers;
};

const verifyClosedOrigin = async (url: string) => {
  const script = new URL(url).hostname.split(".")[0];
  expect(await api(`/workers/scripts/${script}/subdomain`)).toMatchObject({
    enabled: false,
    previews_enabled: false,
  });
  try {
    expect((await fetch(url, { redirect: "manual" })).status).not.toBe(200);
  } catch (error) {
    if (!closedTransport(error)) throw error;
  }
};
