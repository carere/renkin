import { randomUUID } from "node:crypto";
import { expect } from "@effect/vitest";
import { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";
import type { EnvironmentState } from "@renkin/core/models/state";
import { Effect } from "effect";

const workerUrl = (state: EnvironmentState, id: string) => {
  const output = state.resources[id]?.outputs as { url?: string } | undefined;
  if (!output?.url) throw new Error(`Missing ${id} Worker URL.`);
  return output.url;
};
const read = (url: string, path: string, init?: RequestInit) =>
  fetch(new URL(path, url), { ...init, signal: AbortSignal.timeout(15000) });
const headers = { authorization: "Bearer local-demo" };

export const assertCloudFlow = async (state: EnvironmentState) => {
  const consoleUrl = workerUrl(state, "Console");
  for (const id of ["Console", "CustomerHub", "Storefront"]) {
    await expect
      .poll(async () => (await read(workerUrl(state, id), "/")).status, {
        timeout: 60000,
        interval: 1000,
      })
      .toBe(200);
  }
  expect((await read(consoleUrl, "/api/login")).status).toBe(200);
  await expect
    .poll(async () => (await read(consoleUrl, "/api/orders", { headers })).status, {
      timeout: 60000,
      interval: 1000,
    })
    .toBe(200);
  await assertCloudFile(consoleUrl);
  const id = `order-${randomUUID()}`;
  console.info(
    `Cloud graph authorized email operation: ${id} (one Workflow task, retries disabled).`,
  );
  expect(
    (
      await read(consoleUrl, "/api/orders", {
        method: "POST",
        headers,
        body: JSON.stringify({ id }),
      })
    ).status,
  ).toBe(202);
  await expect
    .poll(async () => (await read(workerUrl(state, "Jobs"), `/${id}`)).json(), {
      timeout: 120000,
      interval: 1500,
    })
    .toMatchObject({ status: "complete" });
  await expect
    .poll(async () => (await read(workerUrl(state, "Notifications"), `/${id}`)).json(), {
      timeout: 60000,
      interval: 1500,
    })
    .toEqual({ attempts: "1", accepted: "yes" });
  await expect
    .poll(async () => (await read(workerUrl(state, "Tracking"), "/")).json(), {
      timeout: 60000,
      interval: 1000,
    })
    .toMatchObject({ count: 1, alarms: 1 });
  expect(await (await read(consoleUrl, "/api/orders", { headers })).json()).toEqual([
    { id, status: "complete" },
  ]);
  console.info("Cloud graph native flow passed; exactly one authorized email accepted.");
};

const assertCloudFile = async (url: string) => {
  const signed = async (method: string) => {
    const response = await read(url, `/api/presign?method=${method}`, { headers });
    expect(response.status).toBe(200);
    return ((await response.json()) as { url: string }).url;
  };
  const put = await signed("PUT");
  expect(
    (
      await fetch(put, {
        method: "PUT",
        body: "cloud graph bytes",
        signal: AbortSignal.timeout(15000),
      })
    ).status,
  ).toBe(200);
  const get = await signed("GET");
  expect(await (await fetch(get, { signal: AbortSignal.timeout(15000) })).text()).toBe(
    "cloud graph bytes",
  );
  const tampered = new URL(get);
  tampered.pathname += "-tampered";
  expect((await fetch(tampered, { signal: AbortSignal.timeout(15000) })).status).toBe(403);
  expect(await (await read(url, "/api/file", { headers })).text()).toBe("cloud graph bytes");
};

export const assertCloudCron = async (state: EnvironmentState, cron: string) => {
  const client = createBackgroundClient(
    {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    },
    { request: () => Promise.reject(new Error("Read-only verification.")) },
  );
  const script = state.resources.Tracking?.physicalId;
  if (!script) throw new Error("Missing Tracking Worker.");
  const observed = await Effect.runPromise(client.getSchedules(script));
  expect(observed.schedules?.map((entry) => entry.cron)).toEqual([cron]);
};
