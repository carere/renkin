import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { development } from "@carere/renkin";
import { applicationFixture, capturedEmails, scheduled } from "@carere/renkin/testing";
import type { KVNamespace } from "@cloudflare/workers-types";
import { Effect } from "effect";
import { chromium, type Page } from "playwright";
import type { graph as fixtureGraph } from "#test-fixtures/full-graph/graph.ts";

import { assertIsolated } from "./network-control.ts";

if (process.env.RENKIN_GRAPH_NETWORK_DENIED === "true") await assertIsolated();
const root = process.argv[2];
if (!root) throw new Error("Expected copied fixture directory");
const { graph } = (await import(pathToFileURL(join(root, "graph.ts")).href)) as {
  graph: typeof fixtureGraph;
};
const poll = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const browser = await chromium.launch({ headless: true });
const browserErrors: string[] = [];
const context = await browser.newContext();
context.on("page", (page) => page.on("pageerror", (error) => browserErrors.push(error.message)));
const headers = { authorization: "Bearer local-demo" };
let objectId = "";
type Session = Effect.Success<ReturnType<typeof development>>;
const loginAndCreate = async (session: Session) => {
  assert.deepEqual(
    Object.keys(session.workers).sort(),
    [
      "Auth",
      "API",
      "Jobs",
      "Notifications",
      "Tracking",
      "Console",
      "CustomerHub",
      "Storefront",
    ].sort(),
  );
  const { API, Console } = session.workers;
  assert.ok(API && Console);
  assert.equal((await API.fetch("/orders")).status, 401);
  const page = await context.newPage();
  await page.goto(Console.url);
  await page.getByRole("heading", { name: "Console", exact: true }).waitFor();
  await page.getByRole("button", { name: "Sign in locally" }).click();
  await page.getByTestId("auth").filter({ hasText: "Signed in" }).waitFor();
  await page.getByRole("button", { name: "Create order" }).click();
  await page.getByText("order-1: complete", { exact: true }).waitFor();
  return page;
};
const checkNative = async (session: Session) => {
  const { API, Jobs, Tracking } = session.workers;
  assert.ok(API && Jobs && Tracking);
  await poll(
    async () => (await Jobs.fetch("/order-1")).json() as Promise<{ status: string }>,
    (value) => value.status === "complete",
    "queue/Workflow completion",
  );
  const emails = await Effect.runPromise(capturedEmails(session));
  assert.equal(emails.length, 1);
  assert.match(emails[0] ?? "", /Subject: Order order-1/);
  const tracking = await poll(
    async () =>
      (await Tracking.fetch()).json() as Promise<{
        id: string;
        count: number;
        alarms: number;
      }>,
    (value) => value.alarms === 1,
    "native DO alarm",
  );
  assert.equal(tracking.count, 1);
  const objectId = tracking.id;
  const audit = (await session.bindings("Tracking")).Audit as KVNamespace;
  assert.equal(await audit.get("notified:order-1"), "yes");
  await Effect.runPromise(
    scheduled(Tracking, {
      cron: "*/5 * * * *",
      scheduledTime: new Date("2026-07-30T12:00:00Z"),
    }),
  );
  assert.equal(await audit.get("scheduled"), "*/5 * * * *");
  assert.equal(
    (
      await API.fetch("/orders", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "poison", poison: true }),
      })
    ).status,
    202,
  );
  await poll(
    () => audit.get("dead-letter"),
    (value) => value === JSON.stringify({ id: "poison", poison: true }),
    "dead letter delivery",
  );
  assert.equal(await audit.get("poison-attempts"), "2");
  assert.equal((await Effect.runPromise(capturedEmails(session))).length, 1);
  console.info(
    "graph: D1 migration, authentication, queue/Workflow/email, retry/DLQ, schedule, DO SQLite/alarm passed",
  );

  return objectId;
};
const checkS3 = async (session: Session, page: Page) => {
  const { Console } = session.workers;
  assert.ok(Console);
  const signed: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("X-Amz-Signature")) signed.push(request.url());
  });
  await page.getByRole("button", { name: "Upload attachment" }).click();
  await page.getByTestId("upload").filter({ hasText: "browser order attachment" }).waitFor();
  assert.ok(signed.length >= 2);
  assert.ok(signed.every((url) => new URL(url).origin === new URL(Console.url).origin));
  assert.equal(
    await (await session.bucket("Files")).get("order.txt").then((object) => object?.text()),
    "browser order attachment",
  );
  const tampered = new URL(signed.at(-1) ?? "");
  tampered.pathname = tampered.pathname.replace("order.txt", "tampered.txt");
  assert.equal((await fetch(tampered)).status, 403);
  assert.equal((await fetch(new URL("/cdn-cgi/local/r2/s3/unsigned", Console.url))).status, 400);
};
const checkReload = async (session: Session, page: Page) => {
  const { API, CustomerHub, Storefront } = session.workers;
  assert.ok(API && CustomerHub && Storefront);
  const customer = await context.newPage();
  await customer.goto(CustomerHub.url);
  await customer.getByRole("heading", { name: "Customer Hub", exact: true }).waitFor();
  await customer.getByRole("button", { name: "Sign in locally" }).click();
  await customer.getByText("order-1: complete", { exact: true }).waitFor();
  const store = await context.newPage();
  const ssr = await (await fetch(Storefront.url)).text();
  assert.match(ssr, /API ready/);
  await store.goto(Storefront.url);
  await store.getByTestId("ssr-health").filter({ hasText: "API ready" }).waitFor();
  await store.getByRole("button", { name: "Sign in locally" }).click();
  await store.getByText("order-1: complete", { exact: true }).waitFor();
  const route = join(root, "frontends/console/src/routes/index.tsx");
  await writeFile(
    route,
    (await readFile(route, "utf8")).replace('title="Console"', 'title="Console reloaded"'),
  );
  await page.getByRole("heading", { name: "Console reloaded", exact: true }).waitFor();
  const api = join(root, "services/api.ts");
  await writeFile(api, (await readFile(api, "utf8")).replace("API ready", "API reloaded"));
  await API.reload();
  assert.equal(await (await API.fetch("/health")).text(), "API reloaded");
  assert.equal(((await (await API.fetch("/orders", { headers })).json()) as unknown[]).length, 2);
  await writeFile(
    join(root, "migrations/0002_order_source.sql"),
    "ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'graph';\n",
  );
  await Promise.all([page.close(), customer.close(), store.close()]);
  console.info(
    "graph: three hydrated frontends, SSR native binding, browser-origin signed S3, frontend HMR/native reload passed",
  );
};
const checkPersistence = async (session: Session) => {
  const { API, Jobs, Tracking } = session.workers;
  assert.ok(API && Jobs && Tracking);
  assert.equal(((await (await API.fetch("/orders", { headers })).json()) as unknown[]).length, 2);
  assert.deepEqual(await (await Tracking.fetch()).json(), {
    id: objectId,
    count: 1,
    alarms: 1,
  });
  assert.equal(
    await (await session.bucket("Files")).get("order.txt").then((object) => object?.text()),
    "browser order attachment",
  );
  const database = await session.database("Orders");
  assert.equal(
    (
      await database
        .prepare("SELECT source FROM orders WHERE id = ?")
        .bind("order-1")
        .first<{ source: string }>()
    )?.source,
    "graph",
  );
  assert.equal(
    (await database.prepare("SELECT * FROM __renkin_migrations").all()).results.length,
    2,
  );
  assert.equal(
    ((await (await Jobs.fetch("/order-1")).json()) as { status: string }).status,
    "complete",
  );
  // Captured mail is session-scoped; completed Workflows must not send again.
  assert.equal((await Effect.runPromise(capturedEmails(session))).length, 0);
  assert.deepEqual(browserErrors, []);
  console.info(
    "graph: full restart preserved KV/D1/R2/DO/Workflow identities, applied only the new migration, and did not resend email",
  );
};
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* applicationFixture(() =>
          development(graph(), {
            directory: join(root, "state"),
            watch: false,
            r2S3: { accessKeyId: "local-demo-key", secretAccessKey: "local-demo-secret" },
          }),
        );
        const page = yield* Effect.promise(() => loginAndCreate(fixture.current));
        objectId = yield* Effect.promise(() => checkNative(fixture.current));
        yield* Effect.promise(() => checkS3(fixture.current, page));
        yield* Effect.promise(() => checkReload(fixture.current, page));
        yield* fixture.restart;
        yield* Effect.promise(() => checkPersistence(fixture.current));
      }),
    ),
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const isolated = yield* development(graph({ name: "full-graph-isolated" }), {
          directory: join(root, "state"),
          watch: false,
          r2S3: { accessKeyId: "local-demo-key", secretAccessKey: "local-demo-secret" },
        });
        yield* Effect.promise(async () => {
          assert.equal(
            (await (await isolated.database("Orders")).prepare("SELECT * FROM orders").all())
              .results.length,
            0,
          );
          assert.equal(await (await isolated.bucket("Files")).get("order.txt"), null);
          const tracking = await isolated.workers.Tracking?.fetch();
          assert.ok(tracking);
          const value = (await tracking.json()) as { id: string; count: number };
          assert.notEqual(value.id, objectId);
          assert.equal(value.count, 0);
          assert.equal((await isolated.capturedEmails()).length, 0);
          console.info("graph: separate stack isolation and Review/Companion exclusion passed");
        });
      }),
    ),
  );
} finally {
  await browser.close();
}
