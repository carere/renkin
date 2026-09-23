import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, deploy, removeEnvironment } from "@carere/renkin";
import { durableObject, kv, worker } from "@carere/renkin/cloudflare";
import { Effect } from "effect";

const authorization = () => {
  const prefix = process.env.RENKIN_CLOUDFLARE_TEST_PREFIX;
  const expiry = Date.parse(process.env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "");
  if (
    process.env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    process.env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    !prefix ||
    !Number.isFinite(expiry) ||
    Date.now() >= expiry
  )
    throw new Error(
      "Cloud Durable Object tests require current product, prefix and expiry authorization.",
    );
  return prefix;
};

const scenarioDeadline = () => {
  const originalFetch = globalThis.fetch;
  const started = Date.now();
  let cleaning = false;
  globalThis.fetch = (async (input, init) => {
    if (!cleaning && Date.now() - started > 240_000)
      throw new Error("Cloud DO scenario deadline exceeded.");
    const timeout = AbortSignal.timeout(20_000);
    return originalFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  }) as typeof fetch;
  return {
    clean: () => {
      cleaning = true;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const readCounterSource = () =>
  readFile(new URL("../../fixtures/durable-object/counter.ts", import.meta.url), "utf8");

export const createCloudDurableObjectFixture = async () => {
  const prefix = authorization();
  const deadline = scenarioDeadline();
  const name = `${prefix}-do-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(fileURLToPath(new URL("../../fixtures/do-cloud-", import.meta.url)));
  const entry = join(root, "worker.ts");
  const source = await readCounterSource();
  await writeFile(entry, 'export default {fetch(){return new Response("ready")}}');
  let includeObjects = false;
  let renamed = false;
  const options = {
    environment: "objects",
    yes: true,
    cloudflare: { stateScriptName: `${prefix}-state-v2` },
    progress: ({ id, kind }: { id: string; kind: string }) =>
      console.info(`Cloud DO ${kind}: ${id}`),
  };
  const stack = (allowDelete = false) =>
    defineStack({
      name,
      resources: [
        worker("Api", { entry, compatibilityDate: "2026-07-30", allowDelete }),
        kv("Audit", { allowDelete }),
        ...(includeObjects
          ? [
              durableObject("Counters", {
                worker: "Api",
                className: renamed ? "RenamedCounter" : "Counter",
                ...(renamed ? { renamedFrom: "Counter" } : {}),
                allowDelete,
              }),
            ]
          : []),
      ],
    });
  const run = (allowDelete = false, force = false) => {
    authorization();
    return Effect.runPromise(deploy(stack(allowDelete), { ...options, force }));
  };
  const addClass = async () => {
    includeObjects = true;
    await writeFile(entry, renamed ? source.replace(/\bCounter\b/g, "RenamedCounter") : source);
  };
  const removeClass = async () => {
    includeObjects = false;
    await writeFile(entry, 'export default {fetch(){return new Response("ready")}}');
  };
  const renameClass = async () => {
    renamed = true;
    await writeFile(entry, source.replace(/\bCounter\b/g, "RenamedCounter"));
  };
  const close = async () => {
    authorization();
    deadline.clean();
    try {
      await run(true);
      await Effect.runPromise(removeEnvironment(name, options));
      process.stdout.write(`Cloud DO cleanup completed: ${name}/objects\n`);
    } catch {
      deadline.restore();
      throw new Error(
        `Cloud DO cleanup failed; inspect owned environment ${name}/objects. Fixture retained at ${root}.`,
      );
    }
    deadline.restore();
    await rm(root, { recursive: true, force: true });
  };
  process.stdout.write(`Cloud DO test ownership: ${name}/objects\n`);
  return { name, root, options, stack, run, addClass, removeClass, renameClass, close };
};

export const durableObjectUrl = (value: unknown): string => {
  if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string")
    throw new Error("Missing public Worker URL.");
  return value.url;
};
