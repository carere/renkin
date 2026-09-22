import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
}

/** Numeric-prefix ties retain filesystem enumeration order, matching the reference comparator. */
export const orderSqlNames = (names: readonly string[]): string[] =>
  [...names].sort((left, right) => {
    const a = Number.parseInt(left.split("_")[0] ?? "", 10);
    const b = Number.parseInt(right.split("_")[0] ?? "", 10);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a - b;
    if (!Number.isNaN(a)) return -1;
    if (!Number.isNaN(b)) return 1;
    return left.localeCompare(right);
  });

const journalNames = (value: unknown, files: readonly string[]): string[] => {
  if (
    !value ||
    typeof value !== "object" ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("Invalid Drizzle migration journal: expected entries array.");
  }
  const names = value.entries.map((entry: unknown, index: number) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("idx" in entry) ||
      entry.idx !== index ||
      !("tag" in entry) ||
      typeof entry.tag !== "string" ||
      !/^\d+_[a-zA-Z0-9_-]+$/.test(entry.tag)
    ) {
      throw new Error(
        "Invalid Drizzle migration journal: indices must be contiguous and tags valid.",
      );
    }
    return `${entry.tag}.sql`;
  });
  const expected = [...files].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (
    new Set(names).size !== names.length ||
    names.length !== expected.length ||
    names.some((name, i) => name !== expected[i])
  ) {
    throw new Error("Migration SQL files and Drizzle journal order must match.");
  }
  return names;
};

/** Snapshots original bytes before deployment; accepts pre-v1 layout regardless of journal version. */
export const readMigrationFiles = async (directory: string): Promise<readonly MigrationFile[]> => {
  const files = (await readdir(directory, { recursive: true })).filter((name) =>
    name.endsWith(".sql"),
  );
  let journal: string | undefined;
  try {
    journal = await readFile(join(directory, "meta", "_journal.json"), "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const names =
    journal === undefined ? orderSqlNames(files) : journalNames(JSON.parse(journal), files);
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(join(directory, name));
      return {
        name,
        bytes,
        sql: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
        hash: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
};
