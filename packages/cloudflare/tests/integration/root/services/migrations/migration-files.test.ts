import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  orderSqlNames,
  readMigrationFiles,
} from "../../../../../src/contexts/root/services/migrations/migration-files.ts";

const directory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-migrations-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
);

it.effect("reads plain SQL recursively, preserving names and bytes without Drizzle", () =>
  Effect.gen(function* () {
    const path = yield* directory;
    yield* Effect.promise(async () => {
      await mkdir(join(path, "nested"));
      await writeFile(join(path, "10_later.sql"), "SELECT 10;\r\n");
      await writeFile(
        join(path, "2_first.sql"),
        Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("SELECT 'café';\n")]),
      );
      await writeFile(join(path, "nested", "query.sql"), "SELECT 3;");
      const files = await readMigrationFiles(path);
      expect(files.map((file) => file.name)).toEqual([
        "2_first.sql",
        "10_later.sql",
        "nested/query.sql",
      ]);
      for (const file of files)
        expect(Buffer.from(file.bytes)).toEqual(await readFile(join(path, file.name)));
      expect(files[0]?.sql.charCodeAt(0)).toBe(0xfeff);
      expect(files[1]?.sql).toBe("SELECT 10;\r\n");
    });
  }),
);

it.effect("accepts Delimoov version7 journal with version6 entries and validates agreement", () =>
  Effect.gen(function* () {
    const path = yield* directory;
    yield* Effect.promise(async () => {
      await mkdir(join(path, "meta"));
      await writeFile(
        join(path, "0000_initial.sql"),
        "CREATE TABLE x (id INTEGER);--> statement-breakpoint\nSELECT 1;",
      );
      const journal = {
        version: "7",
        dialect: "sqlite",
        entries: [{ idx: 0, version: "6", when: 1, tag: "0000_initial", breakpoints: true }],
      };
      await writeFile(join(path, "meta", "_journal.json"), JSON.stringify(journal));
      expect((await readMigrationFiles(path))[0]?.name).toBe("0000_initial.sql");
      for (const invalid of [
        null,
        {},
        { entries: [{}] },
        { entries: [{ idx: 1, tag: "0000_initial" }] },
        { entries: [journal.entries[0], journal.entries[0]] },
        { entries: [{ idx: 0, tag: "0001_missing" }] },
      ]) {
        await writeFile(join(path, "meta", "_journal.json"), JSON.stringify(invalid));
        await expect(readMigrationFiles(path)).rejects.toThrow();
      }
    });
  }),
);

it.effect("empty SQL directories and empty journals produce no migrations", () =>
  Effect.gen(function* () {
    const path = yield* directory;
    yield* Effect.promise(async () => {
      expect(await readMigrationFiles(path)).toEqual([]);
      await mkdir(join(path, "meta"));
      await writeFile(join(path, "meta", "_journal.json"), '{"version":"7","entries":[]}');
      expect(await readMigrationFiles(path)).toEqual([]);
    });
  }),
);

it.effect("numeric-prefix ties retain input order, including partially numeric prefixes", () =>
  Effect.sync(() => {
    expect(
      orderSqlNames([
        "2_b.sql",
        "2_a.sql",
        "2x_partial.sql",
        "10_later.sql",
        "1_first.sql",
        "z.sql",
        "a.sql",
      ]),
    ).toEqual([
      "1_first.sql",
      "2_b.sql",
      "2_a.sql",
      "2x_partial.sql",
      "10_later.sql",
      "a.sql",
      "z.sql",
    ]);
  }),
);

it.effect("rejects journal reorder and duplicate tags despite contiguous indices", () =>
  Effect.gen(function* () {
    const path = yield* directory;
    yield* Effect.promise(async () => {
      await mkdir(join(path, "meta"));
      await writeFile(join(path, "0000_first.sql"), "SELECT 0;");
      await writeFile(join(path, "0001_second.sql"), "SELECT 1;");
      for (const tags of [
        ["0001_second", "0000_first"],
        ["0000_first", "0000_first"],
      ]) {
        const entries = tags.map((tag, idx) => ({ idx, tag, version: "6" }));
        await writeFile(
          join(path, "meta", "_journal.json"),
          JSON.stringify({ version: "7", entries }),
        );
        await expect(readMigrationFiles(path)).rejects.toThrow("journal order must match");
      }
    });
  }),
);

it.effect("rejects invalid UTF-8 rather than silently changing SQL bytes", () =>
  Effect.gen(function* () {
    const path = yield* directory;
    yield* Effect.promise(async () => {
      await writeFile(join(path, "0000_invalid.sql"), Buffer.from([0xc3, 0x28]));
      await expect(readMigrationFiles(path)).rejects.toThrow();
    });
  }),
);
