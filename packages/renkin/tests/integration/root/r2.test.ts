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
