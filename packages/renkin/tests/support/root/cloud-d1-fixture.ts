import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { defineStack, deploy, removeEnvironment } from "renkin";
import { d1, worker } from "renkin/cloudflare";

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
      "Cloud D1 tests require current explicit product, resource-prefix and expiry authorization.",
    );
  return prefix;
};

export const createCloudD1Fixture = async () => {
  const prefix = authorization();
  const originalFetch = globalThis.fetch;
  const startedAt = Date.now();
  let cleaning = false;
  globalThis.fetch = (async (input, init) => {
    if (!cleaning && Date.now() - startedAt > 180_000)
      throw new Error("Cloud D1 scenario deadline exceeded; starting cleanup.");
    const timeout = AbortSignal.timeout(20_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return originalFetch(input, { ...init, signal });
  }) as typeof fetch;
  const name = `${prefix}-d1-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(fileURLToPath(new URL("../../fixtures/d1-cloud-", import.meta.url)));
  const migrations = join(root, "migrations");
  await mkdir(migrations);
  await writeFile(
    join(migrations, "0000_initial.sql"),
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1,'Ada');",
  );
  const entry = join(root, "worker.ts");
  await writeFile(
    entry,
    `import {Effect} from "effect";import {d1} from "renkin/cloudflare";import {defineWorker} from "renkin/worker";
export default defineWorker({DB:d1("Database")},({DB})=>({fetch:(request)=>Effect.gen(function*(){
 if(new URL(request.url).pathname==="/history")return Response.json((yield* DB.query("SELECT name FROM __renkin_migrations ORDER BY rowid")).results);
 if(new URL(request.url).pathname==="/batch")return Response.json(yield* Effect.promise(()=>DB.native.batch([DB.native.prepare("SELECT 2 AS n"),DB.native.prepare("SELECT 1 AS n")])));
 return Response.json((yield* DB.query("SELECT id,name FROM users ORDER BY id")).results);
})}));`,
  );
  const api = worker("Api", { entry, compatibilityDate: "2026-07-30" });
  const options = {
    environment: "migration",
    yes: true,
    cloudflare: { stateScriptName: `${prefix}-state-v2` },
  };
  const stack = (
    allowDelete = false,
    readReplication: "auto" | "disabled" = "disabled",
    includeMigrations = true,
  ) =>
    defineStack({
      name,
      resources: [
        d1("Database", {
          ...(includeMigrations ? { migrations } : {}),
          allowDelete,
          readReplication,
        }),
        api,
      ],
    });
  const deployCurrent = (allowDelete = false, replication: "auto" | "disabled" = "disabled") => {
    authorization();
    return Effect.runPromise(deploy(stack(allowDelete, replication), options));
  };
  const close = async () => {
    authorization();
    cleaning = true;
    try {
      await Effect.runPromise(deploy(stack(true, "disabled", false), options));
      await Effect.runPromise(removeEnvironment(name, options));
      console.info(`Cloud D1 cleanup completed: ${name}/migration`);
    } catch {
      throw new Error(`Cloud D1 cleanup failed; inspect owned environment ${name}/migration.`);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
  };
  console.info(`Cloud D1 test ownership: ${name}/migration`);
  return { name, root, migrations, options, deploy: deployCurrent, close };
};

export const readCloudD1 = async (url: string, path = "/"): Promise<unknown> => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(3_000) }).catch(
      () => undefined,
    );
    if (response?.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("D1 Worker did not become ready before the propagation deadline.");
};
