import type { R2Bucket } from "@cloudflare/workers-types";
import { Effect } from "effect";

export interface R2Requirement {
  readonly type: "cloudflare.r2";
  readonly id: string;
}
export type NativeR2 = R2Bucket;
export class R2BindingError extends Error {
  readonly name = "R2BindingError";
  constructor(
    readonly binding: string,
    readonly operation: string,
  ) {
    super(`R2 binding ${binding} failed during ${operation}.`);
  }
}
export const r2Client = (native: NativeR2, binding: string) => {
  const call = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: () => new R2BindingError(binding, operation) });
  return {
    native,
    get: (key: string, options?: Parameters<NativeR2["get"]>[1]) =>
      call("get", () => native.get(key, options)),
    head: (key: string) => call("head", () => native.head(key)),
    put: (
      key: string,
      value: Parameters<NativeR2["put"]>[1],
      options?: Parameters<NativeR2["put"]>[2],
    ) => call("put", () => native.put(key, value, options)),
    delete: (keys: string | string[]) => call("delete", () => native.delete(keys)),
    list: (options?: Parameters<NativeR2["list"]>[0]) => call("list", () => native.list(options)),
  };
};
export type R2Client = ReturnType<typeof r2Client>;
