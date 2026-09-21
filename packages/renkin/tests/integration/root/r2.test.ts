import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack } from "renkin";
import { r2 } from "renkin/cloudflare";
import { createR2Fixture, signedR2 } from "../../support/root/r2-fixture.ts";

const fixture = Effect.acquireRelease(Effect.promise(createR2Fixture), (test) =>
  Effect.promise(test.close),
);
it.effect(
  "public inferred R2 and opt-in S3 share persistent storage and preserve explicit logical renames",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await test.run(async ({ workers, bucket }) => {
          const api = workers.Api;
          if (!api) throw new Error("Missing Worker");
          expect(
            (await fetch(await signedR2(api.url, "Files", "object", "PUT", "from HTTP"))).status,
          ).toBe(200);
          expect(await (await api.fetch("/native")).text()).toBe("from HTTP");
          expect(await (await bucket("Files")).get("object").then((object) => object?.text())).toBe(
            "from HTTP",
          );
          expect((await fetch(await signedR2(api.url, "Other", "object"))).status).toBe(404);
          expect(await (await api.fetch()).text()).toBe("application");
        });
        await test.run(async ({ bucket }) =>
          expect(await (await bucket("Files")).get("object").then((object) => object?.text())).toBe(
            "from HTTP",
          ),
        );
        await writeFile(
          test.entry,
          (await readFile(test.entry, "utf8")).replace('r2("Files")', 'r2("Renamed")'),
        );
        const renamed = defineStack({
          ...test.stack,
          renames: [{ from: "Files", to: "Renamed" }],
          resources: [
            r2("Renamed"),
            ...test.stack.resources.filter((resource) => resource.id !== "Files"),
          ],
        });
        await test.run(
          async ({ bucket }) =>
            expect(
              await (await bucket("Renamed")).get("object").then((object) => object?.text()),
            ).toBe("from HTTP"),
          renamed,
        );
      });
    }),
  30000,
);

it.effect(
  "R2 protection precedes changes and nonempty removal needs separate forceDestroy permission",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await test.run(async ({ bucket }) => {
          await (await bucket("Files")).put("keep", "data");
          await (await bucket("Other")).put("foreign", "permanent");
        });
        const replace = (allowDelete: boolean, forceDestroy: boolean) =>
          defineStack({
            ...test.stack,
            resources: [
              r2("Files", { identity: "new", allowDelete, forceDestroy }),
              ...test.stack.resources.filter((resource) => resource.id !== "Files"),
            ],
          });
        await expect(test.run(async () => {}, replace(false, true))).rejects.toThrow(
          "Deletion protection",
        );
        await expect(test.run(async () => {}, replace(true, false))).rejects.toThrow(
          "forceDestroy",
        );
        await test.run(async ({ bucket }) =>
          expect(await (await bucket("Files")).get("keep").then((object) => object?.text())).toBe(
            "data",
          ),
        );
        await test.run(
          async ({ bucket }) => {
            expect(await (await bucket("Files")).get("keep")).toBeNull();
            expect(
              await (await bucket("Other")).get("foreign").then((object) => object?.text()),
            ).toBe("permanent");
          },
          replace(true, true),
        );
      });
    }),
  30000,
);

it.effect(
  "local S3 is disabled unless configured and never swallows ordinary application routing",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(() =>
        test.run(
          async ({ workers }) => {
            const api = workers.Api;
            if (!api) throw new Error("Missing Worker");
            expect(await (await fetch(await signedR2(api.url, "Files", "object"))).text()).toBe(
              "application",
            );
          },
          test.stack,
          false,
        ),
      );
    }),
);

it.effect(
  "Worker applications sign using an explicit credential binding with only its declared buckets",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await writeFile(
          test.entry,
          `import {Effect} from "effect";import {r2,r2Token} from "renkin/cloudflare";import {defineWorker} from "renkin/worker";import {AwsClient} from "aws4fetch";
const token=r2Token("Uploads",{buckets:[r2("Files")],permissions:"read-write",expiresAt:"2099-01-01T00:00:00Z"});
export default defineWorker({Uploads:token},({Uploads})=>({fetch:request=>Effect.promise(async()=>{
 const config=Uploads.forRequest(request);const signer=new AwsClient({...config,service:"s3"});
 const signed=await signer.sign(config.endpoint+config.buckets.Files+"/from-app",{method:"PUT",aws:{signQuery:true}});
 return Response.json({url:signed.url,buckets:config.buckets});
})}));`,
        );
        const { r2Token } = await import("renkin/cloudflare");
        const stack = defineStack({
          ...test.stack,
          resources: [
            ...test.stack.resources,
            r2Token("Uploads", {
              buckets: [r2("Files")],
              permissions: "read-write",
              expiresAt: "2099-01-01T00:00:00Z",
            }),
          ],
        });
        await test.run(async ({ workers, bucket }) => {
          const app = workers.Api;
          if (!app) throw new Error("Missing Worker");
          const result = (await (await app.fetch()).json()) as {
            url: string;
            buckets: Record<string, string>;
          };
          expect(result.buckets).toEqual({ Files: "Files" });
          expect(
            (await fetch(result.url, { method: "PUT", body: "signed by application" })).status,
          ).toBe(200);
          expect(
            await (await bucket("Files")).get("from-app").then((object) => object?.text()),
          ).toBe("signed by application");
          expect((await fetch(await signedR2(app.url, "Other", "object"))).status).toBe(404);
        }, stack);
        await expect(test.run(async () => {}, stack, false)).rejects.toThrow(
          "Local application startup failed.",
        );
      });
    }),
);

it.effect(
  "named local previews persist independently for identical logical bucket IDs",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        await test.run(
          async ({ bucket }) => {
            await (await bucket("Files")).put("same", "preview A");
          },
          test.stack,
          true,
          "preview-a",
        );
        await test.run(
          async ({ bucket }) => {
            expect(await (await bucket("Files")).get("same")).toBeNull();
            await (await bucket("Files")).put("same", "preview B");
          },
          test.stack,
          true,
          "preview-b",
        );
        await test.run(
          async ({ bucket }) =>
            expect(await (await bucket("Files")).get("same").then((object) => object?.text())).toBe(
              "preview A",
            ),
          test.stack,
          true,
          "preview-a",
        );
        await test.run(
          async ({ bucket }) =>
            expect(await (await bucket("Files")).get("same").then((object) => object?.text())).toBe(
              "preview B",
            ),
          test.stack,
          true,
          "preview-b",
        );
      });
    }),
  30000,
);
