interface Sql {
  exec<T>(query: string, ...bindings: (string | number)[]): { toArray(): T[] };
}
const chunkSize = 256 * 1024;
const maximumSize = 64 * 1024 * 1024;

/** Ciphertext chunks stay below SQLite's row limit; callers own the atomic state/receipt transaction. */
export class ChunkedStateStorage {
  constructor(private readonly sql: Sql) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS state_chunks (environment TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(environment,part))",
    );
  }
  read(environment: string): string | undefined {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM records WHERE key = ?", `state:${environment}`)
      .toArray()[0];
    if (!row) return undefined;
    const manifest: unknown = JSON.parse(row.value);
    if (typeof manifest === "string") return manifest; // Existing v2 single-row ciphertext.
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("chunks" in manifest) ||
      !("length" in manifest) ||
      !Number.isSafeInteger(manifest.chunks) ||
      !Number.isSafeInteger(manifest.length) ||
      typeof manifest.chunks !== "number" ||
      typeof manifest.length !== "number" ||
      manifest.length < 1 ||
      manifest.length > maximumSize ||
      manifest.chunks !== Math.ceil(manifest.length / chunkSize)
    )
      throw new Error("Encrypted state chunk manifest is invalid.");
    const { chunks: count, length } = manifest;
    const chunks = this.sql
      .exec<{ part: number; value: string }>(
        "SELECT part,value FROM state_chunks WHERE environment = ? ORDER BY part",
        environment,
      )
      .toArray();
    if (
      chunks.length !== count ||
      chunks.some(
        (chunk, index) =>
          chunk.part !== index ||
          chunk.value.length !== (index === count - 1 ? length - index * chunkSize : chunkSize),
      )
    )
      throw new Error("Encrypted state chunks are missing or truncated.");
    return chunks.map((chunk) => chunk.value).join("");
  }
  remove(environment: string): void {
    this.sql.exec("DELETE FROM state_chunks WHERE environment = ?", environment);
    this.sql.exec("DELETE FROM records WHERE key = ?", `state:${environment}`);
  }
  write(environment: string, ciphertext: string): void {
    if (ciphertext.length < 1 || ciphertext.length > maximumSize)
      throw new Error("Encrypted state exceeds the supported 64 MiB size.");
    this.sql.exec("DELETE FROM state_chunks WHERE environment = ?", environment);
    const count = Math.ceil(ciphertext.length / chunkSize);
    for (let part = 0; part < count; part++)
      this.sql.exec(
        "INSERT INTO state_chunks VALUES (?,?,?)",
        environment,
        part,
        ciphertext.slice(part * chunkSize, (part + 1) * chunkSize),
      );
    this.sql.exec(
      "INSERT OR REPLACE INTO records VALUES (?,?)",
      `state:${environment}`,
      JSON.stringify({ chunks: count, length: ciphertext.length }),
    );
  }
}
