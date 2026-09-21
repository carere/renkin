import { expect, it } from "@effect/vitest";
import {
  moduleSpecifiers,
  rewriteSpecifiers,
} from "../../../../../src/contexts/root/services/release/module-specifiers.ts";

it("rewrites only module and import-meta URL syntax, preserving consumer source strings", () => {
  const source = `import { value } from '@renkin/core/models/stack';
export type Item = typeof import('./neighbor.ts');
const file = new URL('./worker.ts', import.meta.url);
const ordinary = './keep.ts';
const generated = "import item from '@renkin/consumer/keep.ts'";
const external = import('effect');
// import './comment.ts'
`;
  const result = rewriteSpecifiers(source, (value) =>
    value.startsWith("@renkin/") ? "../core/stack.js" : value.replace(/\.ts$/, ".js"),
  );
  expect(moduleSpecifiers(result).map(({ value }) => value)).toEqual([
    "../core/stack.js",
    "./neighbor.js",
    "./worker.js",
    "effect",
  ]);
  expect(result).toContain("const ordinary = './keep.ts'");
  expect(result).toContain("@renkin/consumer/keep.ts");
  expect(result).toContain("// import './comment.ts'");
});
