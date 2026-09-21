import { Effect } from "effect";

export interface D1Requirement {
  readonly type: "cloudflare.d1";
  readonly id: string;
}
export interface D1Result<T = Record<string, unknown>> {
  readonly success: boolean;
  readonly results: T[];
  readonly meta: Record<string, unknown>;
  readonly error?: string;
}
export interface NativeD1PreparedStatement {
  bind(...values: unknown[]): NativeD1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
}
export interface NativeD1Session {
  prepare(sql: string): NativeD1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: NativeD1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  getBookmark(): string | null;
}
export interface NativeD1 {
  prepare(sql: string): NativeD1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: NativeD1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
  dump(): Promise<ArrayBuffer>;
  withSession(constraintOrBookmark?: string): NativeD1Session;
}

const statements = new WeakMap<
  object,
  { readonly owner: object; readonly native: NativeD1PreparedStatement }
>();
const databases = new WeakMap<object, NativeD1>();

const guardStatement = (
  native: NativeD1PreparedStatement,
  owner: object,
): NativeD1PreparedStatement => {
  const wrapped = new Proxy(native, {
    get(target, key) {
      if (key === "bind")
        return (...values: unknown[]) => guardStatement(target.bind(...values), owner);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  statements.set(wrapped, { owner, native });
  return wrapped;
};

const guardHandle = <T extends NativeD1 | NativeD1Session>(native: T, owner: object): T =>
  new Proxy(native, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => guardStatement(target.prepare(sql), owner);
      if (key === "batch")
        return (batch: NativeD1PreparedStatement[]) => {
          const unwrapped = batch.map((statement) => {
            const provenance = statements.get(statement);
            if (provenance?.owner !== owner)
              throw new Error("D1 batch statements must belong to this database binding.");
            return provenance.native;
          });
          return target.batch(unwrapped);
        };
      if (key === "withSession" && "withSession" in target) {
        return (bookmark?: string) => guardHandle(target.withSession(bookmark), owner);
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

/** Preserves native execution while preventing cross-binding prepared-statement transport. */
export const guardD1 = (native: NativeD1): NativeD1 => {
  const existing = databases.get(native);
  if (existing) return existing;
  const guarded = guardHandle(native, native);
  databases.set(native, guarded);
  databases.set(guarded, guarded);
  return guarded;
};

export class D1BindingError extends Error {
  readonly name = "D1BindingError";
  constructor(
    readonly binding: string,
    readonly operation: string,
  ) {
    super(`D1 binding ${binding} failed during ${operation}.`);
  }
}
export const d1Client = (database: NativeD1, binding: string) => {
  const native = guardD1(database);
  const call = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: () => new D1BindingError(binding, operation),
    });
  return {
    native,
    query: <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) =>
      call("query", () =>
        native
          .prepare(sql)
          .bind(...params)
          .all<T>(),
      ),
    first: <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) =>
      call("first", () =>
        native
          .prepare(sql)
          .bind(...params)
          .first<T>(),
      ),
    run: (sql: string, params: readonly unknown[] = []) =>
      call("run", () =>
        native
          .prepare(sql)
          .bind(...params)
          .run(),
      ),
    batch: <T = Record<string, unknown>>(batch: NativeD1PreparedStatement[]) =>
      call("batch", () => native.batch<T>(batch)),
  };
};
export type D1Client = ReturnType<typeof d1Client>;
