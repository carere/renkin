import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineStack, deploy, listEnvironments, removeEnvironment } from "@carere/renkin";
import { astro, customDomain, kv } from "@carere/renkin/cloudflare";
import { Effect } from "effect";

const authorization = () => {
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
      "Astro cloud tests require current explicit domain, product and expiry authorization.",
    );
  return { prefix, domain, zoneId };
};
export const astroUrl = (state: Effect.Success<ReturnType<typeof deploy>>, id: string): string => {
  const output = state.resources[id]?.outputs;
  if (!output || typeof output !== "object" || !("url" in output) || typeof output.url !== "string")
    throw new Error("Astro Worker URL is missing.");
  return output.url;
};
export const astroRead = async (url: string, includes?: string, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  let status: number | undefined;
  let mismatch = false;
  while (Date.now() < deadline) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    status = response?.status;
    if (response?.ok) {
      const body = await response.text();
      if (includes === undefined || body.includes(includes)) return { response, body };
      mismatch = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Astro HTTP propagation deadline reached for ${new URL(url).host}${new URL(url).pathname} (status ${status ?? "network/TLS unavailable"}${mismatch ? "; content mismatch" : ""}).`,
  );
};
const boundedRequests = () => {
  const original = globalThis.fetch;
  const started = Date.now();
  let cleaning = false;
  globalThis.fetch = async (input, init) => {
    if (!cleaning && Date.now() - started > 480_000)
      throw new Error("Astro scenario deadline reached; cleanup is required.");
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const response = await original(input, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
    });
    if (
      new URL(input instanceof Request ? input.url : input.toString()).pathname === "/v1/mutate"
    ) {
      const result = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { status?: number; bodyBase64?: string };
      if (!response.ok || (result.status ?? 200) >= 400) {
        let codes: number[] = [];
        let categories: string[] = [];
        try {
          const body = JSON.parse(Buffer.from(result.bodyBase64 ?? "", "base64").toString());
          codes = (body.errors ?? [])
            .map((error: { code?: number }) => error.code)
            .filter((code: unknown): code is number => typeof code === "number");
          const messages = (body.errors ?? [])
            .map((error: { message?: unknown }) =>
              typeof error.message === "string" ? error.message : "",
            )
            .join(" ");
          categories = ["module", "syntax", "CPU", "asset", "limit"].filter((category) =>
            messages.toLowerCase().includes(category.toLowerCase()),
          );
        } catch {
          /* Never log provider text, which may contain uploaded configuration. */
        }
        process.stdout.write(
          `Astro gateway failure: HTTP ${response.status}; upstream ${result.status ?? "unknown"}; codes ${JSON.stringify(codes)}; categories ${categories.join(",")}\n`,
        );
      }
    }
    return response;
  };
  return {
    cleaning: () => {
      cleaning = true;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

export const createCloudAstroFixture = () => {
  const scope = authorization();
  const requests = boundedRequests();
  const name = `${scope.prefix}-astro-${randomUUID().slice(0, 8)}`;
  const hostname = `${name}.${scope.domain}`;
  const options = {
    environment: "preview",
    yes: true,
    cloudflare: { stateScriptName: `${scope.prefix}-state-v2` },
    progress: ({ id, kind }: { id: string; kind: string }) =>
      process.stdout.write(`Astro ${kind}: ${id}\n`),
  };
  const stack = (mode: "auto" | "existing" | "disabled") => {
    const content = kv("content", { allowDelete: true });
    const visits = kv("visits", { allowDelete: true });
    const staticSite = astro("static", {
      root: fileURLToPath(new URL("../../../../../apps/example-static/", import.meta.url)),
      output: "static",
      compatibilityDate: "2026-07-30",
    });
    const ssr = astro("ssr", {
      root: fileURLToPath(new URL("../../fixtures/astro-ssr/", import.meta.url)),
      output: "server",
      compatibilityDate: "2026-07-30",
      allowDelete: true,
      sessionKVBindingName:
        mode === "disabled" ? false : mode === "existing" ? "VISITS" : "SESSION",
      bindings: {
        CONTENT: content,
        GREETING: `Astro cloud ${mode}`,
        ...(mode === "existing" ? { VISITS: visits } : {}),
      },
    });
    return defineStack({
      name,
      resources: [
        staticSite,
        ssr,
        ...(mode === "auto" ? [] : [visits]),
        customDomain("domain", { hostname, zoneId: scope.zoneId, worker: staticSite }),
      ],
    });
  };
  process.stdout.write(
    `Astro cloud ownership: ${name}/preview; hostname ${hostname}; backend ${options.cloudflare.stateScriptName}\n`,
  );
  return {
    name,
    hostname,
    options,
    apply: (mode: "auto" | "existing" | "disabled") => {
      authorization();
      return Effect.runPromise(deploy(stack(mode), options));
    },
    close: async () => {
      requests.cleaning();
      try {
        authorization();
        await Effect.runPromise(removeEnvironment(name, options));
        process.stdout.write(`Astro cloud cleanup complete: ${name}/preview\n`);
      } finally {
        requests.restore();
      }
    },
    list: () => Effect.runPromise(listEnvironments(name, { cloudflare: options.cloudflare })),
  };
};
