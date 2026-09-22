import type { NativeKV } from "@renkin/runtime/models/binding";

/** Astro's development driver resolves the native namespace for each request operation. */
export const sessionDriver = (namespace: () => NativeKV) => ({
  name: "renkin-native-kv-session",
  hasItem: async (key: string) => (await namespace().get(key)) !== null,
  getItem: (key: string) => namespace().get(key),
  setItem: (key: string, value: string, options?: { readonly ttl?: number }) =>
    namespace().put(key, value, options?.ttl ? { expirationTtl: Math.max(60, options.ttl) } : {}),
  removeItem: (key: string) => namespace().delete(key),
});
