import type { KVNamespace } from "@cloudflare/workers-types";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Miniflare } from "miniflare";
import { kvClient, type NativeKV } from "#src/contexts/root/models/binding.ts";

const nativeConsumer = (namespace: KVNamespace) =>
  namespace.getWithMetadata<{ count: number }, { author: string }>("record", {
    type: "json",
    cacheTtl: 60,
  });

it.effect("keeps the official native KV options and metadata surface available to consumers", () =>
  Effect.promise(async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-07-30",
      kvNamespaces: { CACHE: "native-cache" },
    });
    try {
      const handle = (await mf.getKVNamespace("CACHE")) as unknown as NativeKV;
      const client = kvClient(handle, "CACHE");
      expect(client.native).toBe(handle);
      await Effect.runPromise(
        client.put("record", JSON.stringify({ count: 1 }), { metadata: { author: "test" } }),
      );
      expect(await nativeConsumer(client.native)).toMatchObject({
        value: { count: 1 },
        metadata: { author: "test" },
      });
      expect(await client.native.get(["record", "missing"], "text")).toEqual(
        new Map([
          ["record", '{"count":1}'],
          ["missing", null],
        ]),
      );
      expect(await Effect.runPromise(client.getJson<{ count: number }>("record"))).toEqual({
        count: 1,
      });
    } finally {
      await mf.dispose();
    }
  }),
);
