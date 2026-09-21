import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { removeEnvironment } from "renkin";
import { createCloudD1Fixture, readCloudD1 } from "#test-support/root/cloud-d1-fixture.ts";

it.effect(
  "deploys protected D1, inferred typed/native binding, migrations and corrected failure recovery",
  () =>
    Effect.promise(async () => {
      const test = await createCloudD1Fixture();
      try {
        const first = await test.deploy();
        const id = first.resources.Database?.physicalId;
        expect(id).toBeTruthy();
        const output = first.resources.Api?.outputs;
        if (
          !output ||
          typeof output !== "object" ||
          Array.isArray(output) ||
          !("url" in output) ||
          typeof output.url !== "string"
        )
          throw new Error("Missing Worker URL");
        const url = output.url;
        expect(await readCloudD1(url)).toEqual([{ id: 1, name: "Ada" }]);
        const batch = (await readCloudD1(url, "/batch")) as { results: unknown[] }[];
        expect(batch.map((result) => result.results)).toEqual([[{ n: 2 }], [{ n: 1 }]]);
        await expect(Effect.runPromise(removeEnvironment(test.name, test.options))).rejects.toThrow(
          "Deletion protection",
        );
        await writeFile(join(test.migrations, "0000_initial.sql"), "INVALID EDITED SQL");
        await writeFile(
          join(test.migrations, "0001_success.sql"),
          "INSERT INTO users VALUES (2,'Grace')",
        );
        await writeFile(
          join(test.migrations, "0002_failure.sql"),
          "INSERT INTO missing VALUES (3)",
        );
        await writeFile(
          join(test.migrations, "0003_later.sql"),
          "INSERT INTO users VALUES (4,'Later')",
        );
        await expect(test.deploy()).rejects.toThrow("manual repair may be required");
        expect(await readCloudD1(url)).toEqual([
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ]);
        await writeFile(
          join(test.migrations, "0002_failure.sql"),
          "INSERT INTO users VALUES (3,'Fixed')",
        );
        const recovered = await test.deploy(false, "auto");
        expect(recovered.resources.Database?.physicalId).toBe(id);
        await rm(join(test.migrations, "0000_initial.sql"));
        const repeated = await test.deploy(false, "auto");
        expect(repeated.resources.Database?.physicalId).toBe(id);
        expect(await readCloudD1(url)).toEqual([
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
          { id: 3, name: "Fixed" },
          { id: 4, name: "Later" },
        ]);
        expect(await readCloudD1(url, "/history")).toHaveLength(4);
        await assertBookkeepingAndRenameBoundaries(test, url);
      } finally {
        await test.close();
      }
    }),
  420000,
);

const assertBookkeepingAndRenameBoundaries = async (
  test: Awaited<ReturnType<typeof createCloudD1Fixture>>,
  url: string,
) => {
  const bookkeeping = join(test.migrations, "0004_bookkeeping.sql");
  await writeFile(
    bookkeeping,
    "INSERT INTO users VALUES (5,'Unrecorded'); DROP TABLE __renkin_migrations;",
  );
  await expect(test.deploy()).rejects.toThrow("0004_bookkeeping.sql");
  expect(await readCloudD1(url, "/history")).toHaveLength(4);
  expect(await readCloudD1(url)).toHaveLength(4);
  await rm(bookkeeping);
  await rename(join(test.migrations, "0003_later.sql"), join(test.migrations, "0005_renamed.sql"));
  await expect(test.deploy()).rejects.toThrow("0005_renamed.sql");
  await rm(join(test.migrations, "0005_renamed.sql"));
  await test.deploy();
  expect(await readCloudD1(url, "/history")).toHaveLength(4);
};
