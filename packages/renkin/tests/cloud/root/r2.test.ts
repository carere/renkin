import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { listEnvironments, readOutputs, removeEnvironment } from "renkin";
import {
  cloudR2Sign,
  cloudRecord,
  cloudString,
  createCloudR2Fixture,
  eventuallyR2,
} from "../../support/root/cloud-r2-fixture.ts";

it.effect(
  "isolates named R2 previews, application credentials, CORS and exact cleanup",
  () =>
    Effect.promise(async () => {
      const test = await createCloudR2Fixture();
      try {
        const first = await test.apply("preview-a");
        const second = await test.apply("preview-b");
        const a = first.resources.Files?.physicalId;
        const b = second.resources.Files?.physicalId;
        if (!a || !b) throw new Error("Missing bucket identity");
        expect(a).not.toBe(b);
        const url = cloudString(cloudRecord(first.resources.Api?.outputs).url);
        const secondUrl = cloudString(cloudRecord(second.resources.Api?.outputs).url);
        const credentials = cloudRecord(first.resources.Uploads?.outputs);
        const otherCredentials = cloudRecord(second.resources.Uploads?.outputs);
        await eventuallyR2("first Worker health", () => fetch(`${url}/health`));
        await eventuallyR2("second Worker health", () => fetch(`${secondUrl}/health`));
        const key = "folder/a %2F café";
        await assertInterop(url, credentials, a, key);
        expect((await fetch(await cloudR2Sign(credentials, b, key))).status).toBe(403);
        await assertReadOnly(secondUrl, otherCredentials, b, key);
        const output = await Effect.runPromise(
          readOutputs(test.name, "preview-a", { cloudflare: test.cloudflare }),
        );
        expect(output?.Uploads === "[REDACTED]").toBe(true);
        await expect(
          Effect.runPromise(removeEnvironment(test.name, test.options("preview-a"))),
        ).rejects.toThrow("Deletion protection");
        const unchanged = await test.apply("preview-a", true, false);
        expect(unchanged.resources.Files?.physicalId).toBe(a);
        await expect(
          Effect.runPromise(removeEnvironment(test.name, test.options("preview-a"))),
        ).rejects.toThrow("forceDestroy");
        await test.apply("preview-a", true, true);
        await test.remove("preview-a");
        expect(
          await Effect.runPromise(listEnvironments(test.name, { cloudflare: test.cloudflare })),
        ).toEqual(["preview-b"]);
        expect([401, 403]).toContain((await fetch(await cloudR2Sign(credentials, a, key))).status);
        expect(await (await fetch(`${secondUrl}/native`)).json()).toMatchObject({
          text: "other preview",
        });
        await test.apply("preview-b", true, true);
        await test.remove("preview-b");
        expect(
          await Effect.runPromise(listEnvironments(test.name, { cloudflare: test.cloudflare })),
        ).toEqual([]);
      } finally {
        await test.close();
      }
    }),
  480000,
);

const assertInterop = async (
  url: string,
  credentials: ReturnType<typeof cloudRecord>,
  a: string,
  key: string,
) => {
  expect((await fetch(`${url}/native`, { method: "PUT", body: "native to S3" })).status).toBe(200);
  const read = await eventuallyR2("native/S3 read", async () =>
    fetch(await cloudR2Sign(credentials, a, key)),
  );
  expect(await read.text()).toBe("native to S3");
  expect(read.headers.get("x-amz-meta-source")).toBe("native");
  expect(read.headers.get("cache-control")).toBe("max-age=60");
  expect(read.headers.get("etag")).toBeTruthy();
  const signed = (await (await fetch(`${url}/sign?method=PUT&key=upload`)).json()) as {
    url: string;
  };
  expect(
    (
      await fetch(signed.url, {
        method: "PUT",
        body: "application signed",
        headers: { "content-type": "text/plain", "x-amz-meta-source": "s3" },
      })
    ).status,
  ).toBe(200);
  expect(await (await fetch(`${url}/native?key=upload`)).json()).toMatchObject({
    text: "application signed",
    metadata: { source: "s3" },
  });
  const cors = await fetch(await cloudR2Sign(credentials, a, key), {
    headers: { origin: "https://app.example" },
  });
  expect(cors.headers.get("access-control-allow-origin")).toBe("https://app.example");
  await cors.body?.cancel();
  const head = await fetch(await cloudR2Sign(credentials, a, key, "HEAD"));
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("12");
  const range = await fetch(await cloudR2Sign(credentials, a, key), {
    headers: { range: "bytes=0-5" },
  });
  expect(range.status).toBe(206);
  expect(await range.text()).toBe("native");
};

const assertReadOnly = async (
  secondUrl: string,
  otherCredentials: ReturnType<typeof cloudRecord>,
  b: string,
  key: string,
) => {
  expect(
    (await fetch(`${secondUrl}/native`, { method: "PUT", body: "other preview" })).status,
  ).toBe(200);
  expect(
    await (
      await eventuallyR2("read-only token read", async () =>
        fetch(await cloudR2Sign(otherCredentials, b, key)),
      )
    ).text(),
  ).toBe("other preview");
  expect(
    (
      await fetch(await cloudR2Sign(otherCredentials, b, "forbidden", "PUT"), {
        method: "PUT",
        body: "must fail",
      })
    ).status,
  ).toBe(403);
};
