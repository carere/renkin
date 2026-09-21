import { expect, it } from "@effect/vitest";
import {
  type SourcePackage,
  sourceImportTarget,
} from "#src/contexts/root/services/release/layout.ts";

const owner: SourcePackage = {
  directory: "/checkout/packages/core",
  manifest: {
    name: "@renkin/core",
    version: "0.0.0",
    exports: {},
    imports: {
      "#src/*": "./src/*",
      "#state": "./src/contexts/root/models/state.ts",
      "#test-support/*": "./tests/support/*",
    },
  },
};
it("resolves exact and deep project aliases within their owning production package", () => {
  expect(sourceImportTarget(owner, "#src/contexts/root/models/state.ts")).toBe(
    "/checkout/packages/core/src/contexts/root/models/state.ts",
  );
  expect(sourceImportTarget(owner, "#state")).toBe(
    "/checkout/packages/core/src/contexts/root/models/state.ts",
  );
  expect(sourceImportTarget({ ...owner, directory: "/checkout/packages/runtime" }, "#state")).toBe(
    "/checkout/packages/runtime/src/contexts/root/models/state.ts",
  );
});
it("rejects undeclared aliases, test support and paths escaping production source", () => {
  expect(() => sourceImportTarget(owner, "#missing")).toThrow("Unknown release alias");
  expect(() => sourceImportTarget(owner, "#test-support/fake.ts")).toThrow("production source");
  expect(() => sourceImportTarget(owner, "#src/../tests/fake.ts")).toThrow("production source");
});
