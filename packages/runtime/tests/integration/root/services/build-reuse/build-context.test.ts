import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { BuildProducer } from "../../../../../src/contexts/root/models/build-reuse.ts";
import { createBuildContext } from "../../../../../src/contexts/root/services/build-reuse/build-context.ts";

const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const root = await mkdtemp(resolve(tmpdir(), "renkin-reuse-"));
    await writeFile(resolve(root, "source.txt"), "first");
    let builds = 0;
    const producer: BuildProducer = {
      root,
      adapter: "test-compiler-v1",
      values: {},
      async build() {
        builds++;
        await mkdir(resolve(root, "dist/assets"), { recursive: true });
        const source = await readFile(resolve(root, "source.txt"), "utf8");
        await writeFile(
          resolve(root, "dist/entry.mjs"),
          `export default ${JSON.stringify(source)};`,
        );
        await writeFile(resolve(root, "dist/chunk.txt"), source);
        await writeFile(resolve(root, "dist/assets/index.html"), source);
        await writeFile(resolve(root, "dist/assets/_headers"), "/*\n  X-Built: yes\n");
        return {
          entry: resolve(root, "dist/entry.mjs"),
          modules: [{ path: "chunk.txt", type: "text/plain" }],
          assets: { directory: resolve(root, "dist/assets") },
        };
      },
    };
    return { root, producer, builds: () => builds };
  }),
  ({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

it.live(
  "coalesces one operation, validates reuse, and captures before later builds overwrite outputs",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        const context = createBuildContext();
        const [first, other] = await Promise.all([
          context.resolve(test.producer),
          context.resolve(test.producer),
        ]);
        expect(other).toEqual(first);
        expect(test.builds()).toBe(1);
        expect(await createBuildContext().resolve(test.producer)).toEqual(first);
        expect(test.builds()).toBe(1);
        await writeFile(resolve(test.root, "source.txt"), "second");
        const second = await createBuildContext().resolve(test.producer);
        expect(test.builds()).toBe(2);
        expect(await readFile(first.entry, "utf8")).toContain('"first"');
        expect(await readFile(second.entry, "utf8")).toContain('"second"');
      });
    }).pipe(Effect.scoped),
);

it.live(
  "rebuilds missing entry, listed chunk, asset, routing file and damaged captured output",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        let build = await createBuildContext().resolve(test.producer);
        for (const path of [
          "dist/entry.mjs",
          "dist/chunk.txt",
          "dist/assets/index.html",
          "dist/assets/_headers",
        ]) {
          const before = test.builds();
          await rm(resolve(test.root, path));
          build = await createBuildContext().resolve(test.producer);
          expect(test.builds()).toBe(before + 1);
        }
        await writeFile(build.entry, "damaged");
        const restored = await createBuildContext().resolve(test.producer);
        expect(test.builds()).toBe(6);
        expect(await readFile(restored.entry, "utf8")).toContain('"first"');
      });
    }).pipe(Effect.scoped),
);

it.live("invalidates explicit values and shared files while opaque callbacks remain uncached", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.promise(async () => {
      const preview = { ...test.producer, values: { stage: "preview" } };
      const production = { ...test.producer, values: { stage: "production" } };
      await createBuildContext().resolve(preview);
      await createBuildContext().resolve(production);
      expect(test.builds()).toBe(2);
      await createBuildContext().resolve({ ...production, cacheable: false });
      await createBuildContext().resolve({ ...production, cacheable: false });
      expect(test.builds()).toBe(4);
    });
  }).pipe(Effect.scoped),
);
