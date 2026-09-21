import { expect, it } from "@effect/vitest";
import { kv } from "#src/contexts/root/models/kv.ts";
import { worker } from "#src/contexts/root/models/worker.ts";
import { expandResources } from "#src/contexts/root/services/worker/expand-resources.ts";

it("expands shared owned dependencies once and preserves explicit declarations", () => {
  const data = kv("Data");
  const first = worker("First", { compatibilityDate: "2026-07-30", dependencies: [data] });
  const second = worker("Second", { compatibilityDate: "2026-07-30", dependencies: [data, first] });
  expect(expandResources([second, data])).toEqual([second, data, first]);
});

it("rejects a conflicting implicit resource before build or mutation", () => {
  const data = kv("Data");
  const site = worker("Site", { compatibilityDate: "2026-07-30", dependencies: [data] });
  expect(() => expandResources([site, kv("Data", { allowDelete: true })])).toThrow(
    "Conflicting resource definitions: Data",
  );
});
