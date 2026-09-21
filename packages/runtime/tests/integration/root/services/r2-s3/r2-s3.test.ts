import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { verifyPresignedRequest } from "#src/contexts/root/services/r2-s3/sigv4.ts";
import { createS3Fixture, credentials, signer } from "#test-support/root/r2-s3-fixture.ts";

const fixture = Effect.acquireRelease(Effect.promise(createS3Fixture), (value) =>
  Effect.promise(value.close),
);
it.effect(
  "application-signed HTTP shares native R2 objects, metadata, isolation and persistent storage",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        const key = "folder/space +%2F café";
        const upload = await fetch(
          await test.signed("PUT", key, {
            body: "hello world",
            headers: { "content-type": "text/plain", "x-amz-meta-owner": "header" },
            query: { "x-amz-meta-owner": "query" },
          }),
        );
        expect(upload.status).toBe(200);
        const native = await (await test.bucket()).get(key);
        expect(await native?.text()).toBe("hello world");
        expect(native?.customMetadata).toEqual({ owner: "query" });
        expect(upload.headers.get("etag")).toBe(native?.httpEtag);
        expect(await (await test.bucket("B")).get(key)).toBeNull();
        await (await test.bucket()).put("native", "from native");
        expect(await (await fetch(await test.signed("GET", "native"))).text()).toBe("from native");
        const response = await fetch(
          await test.signed("GET", key, {
            query: { "response-content-type": "application/example" },
          }),
        );
        expect(response.headers.get("content-type")).toBe("application/example");
        expect(response.headers.get("x-amz-meta-owner")).toBe("query");
        expect(response.headers.get("content-length")).toBe("11");
        expect(await response.text()).toBe("hello world");
        await test.restart();
        expect(await (await fetch(await test.signed("GET", key))).text()).toBe("hello world");
        expect(await (await fetch(test.url())).text()).toBe("application fallback");
      });
    }),
);

it.effect(
  "supports HEAD, precise single ranges, full-object multiple-range fallback and local preflight",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await (await test.bucket()).put("object", "0123456789");
        for (const [range, status, body, contentRange] of [
          ["bytes=2-4", 206, "234", "bytes 2-4/10"],
          ["bytes=-100", 206, "0123456789", "bytes 0-9/10"],
          ["bytes=8-", 206, "89", "bytes 8-9/10"],
          ["bytes=0-1,8-9", 200, "0123456789", null],
        ] as const) {
          const response = await fetch(await test.signed("GET", "object", { headers: { range } }));
          expect(response.status).toBe(status);
          expect(response.headers.get("content-range")).toBe(contentRange);
          expect(await response.text()).toBe(body);
        }
        for (const range of ["bytes=11-", "bytes=-0", "bytes=5-2", "invalid"]) {
          const response = await fetch(await test.signed("GET", "object", { headers: { range } }));
          expect(response.status).toBe(416);
          expect(response.headers.get("content-range")).toBe("bytes */10");
          expect(await response.text()).toContain("InvalidRange");
        }
        const head = await fetch(await test.signed("HEAD", "object"));
        expect(head.status).toBe(200);
        expect(head.headers.get("content-length")).toBe("10");
        expect(await head.text()).toBe("");
        const missing = await fetch(await test.signed("HEAD", "missing"));
        expect(missing.status).toBe(404);
        expect(await missing.text()).toBe("");
        const preflight = await fetch(new URL("/cdn-cgi/local/r2/s3/first/object", test.url()), {
          method: "OPTIONS",
          headers: { "access-control-request-headers": "x-test,content-type" },
        });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
        expect(preflight.headers.get("access-control-allow-headers")).toBe("x-test,content-type");
      });
    }),
);

it.effect("rejects invalid signatures, unknown buckets and unsupported upload semantics", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.promise(async () => {
      const signed = await test.signed("GET", "missing");
      const bad = new URL(signed.url);
      bad.searchParams.set("X-Amz-Signature", "0".repeat(64));
      const denied = await fetch(bad);
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("SignatureDoesNotMatch");
      const unknown = await fetch(await test.signed("GET", "object", { bucket: "__proto__" }));
      expect(unknown.status).toBe(404);
      expect(await unknown.text()).toContain("NoSuchBucket");
      for (const headers of [
        { "content-md5": "example" },
        { "x-amz-checksum-sha256": "example" },
        { "x-amz-server-side-encryption": "AES256" },
        { "x-amz-storage-class": "STANDARD" },
        { "content-encoding": "aws-chunked" },
      ]) {
        const response = await fetch(
          await test.signed("PUT", "unsupported", { body: "x", headers }),
        );
        expect(response.status).toBe(501);
        expect(await response.text()).toContain("NotImplemented");
      }
      expect(await (await test.bucket()).get("unsupported")).toBeNull();
      const empty = await fetch(await test.signed("PUT", "empty"));
      expect(empty.status).toBe(200);
      expect((await (await test.bucket()).head("empty"))?.size).toBe(0);
    });
  }),
);

it.effect(
  "verifies exact expiry/time bounds and rejects malformed SigV4 parameters using independent signing",
  () =>
    Effect.promise(async () => {
      const now = Date.UTC(2026, 8, 21, 10, 0, 0);
      const sign = async (expires: string, datetime = "20260921T100000Z") =>
        signer.sign(`https://example.test/cdn-cgi/local/r2/s3/b/key?X-Amz-Expires=${expires}`, {
          aws: { signQuery: true, datetime },
        });
      for (const expiry of ["1", "604800"])
        await expect(
          verifyPresignedRequest(await sign(expiry), credentials, now),
        ).resolves.toBeUndefined();
      for (const expiry of ["0", "604801", "1.5", "-1"])
        await expect(
          verifyPresignedRequest(await sign(expiry), credentials, now),
        ).rejects.toMatchObject({ code: "InvalidArgument" });
      await expect(
        verifyPresignedRequest(await sign("1"), credentials, now + 1000),
      ).resolves.toBeUndefined();
      await expect(
        verifyPresignedRequest(await sign("1"), credentials, now + 1001),
      ).rejects.toMatchObject({ code: "ExpiredRequest" });
      await expect(
        verifyPresignedRequest(await sign("60", "20260921T101500Z"), credentials, now),
      ).resolves.toBeUndefined();
      await expect(
        verifyPresignedRequest(await sign("60", "20260921T101501Z"), credentials, now),
      ).rejects.toMatchObject({ code: "RequestTimeTooSkewed" });
      for (const mutate of [
        (url: URL) => url.searchParams.append("X-Amz-Date", "20260921T100000Z"),
        (url: URL) => url.searchParams.set("X-Amz-Date", "20260230T100000Z"),
        (url: URL) => url.searchParams.set("X-Amz-Security-Token", "session"),
        (url: URL) => url.searchParams.set("X-Amz-SignedHeaders", "host;host"),
      ]) {
        const request = await sign("60");
        const url = new URL(request.url);
        mutate(url);
        await expect(
          verifyPresignedRequest(new Request(url), credentials, now),
        ).rejects.toMatchObject({ code: "InvalidArgument" });
      }
    }),
);
