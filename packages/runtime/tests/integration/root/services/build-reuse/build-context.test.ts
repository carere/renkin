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
        await writeFile(resolve(root, "dist/entry.mjs.map"), JSON.stringify({ sources: [source] }));
        await writeFile(resolve(root, "dist/assets/index.html"), source);
        await writeFile(resolve(root, "dist/assets/_headers"), "/*\n  X-Built: yes\n");
        return {
          entry: resolve(root, "dist/entry.mjs"),
          modules: [{ path: "chunk.txt", type: "text/plain" }],
          auxiliaryFiles: ["entry.mjs.map"],
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
          "dist/entry.mjs.map",
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
        expect(test.builds()).toBe(7);
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

it.live(
  "serializes different stage compilers and captures each stage before releasing their shared output",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.promise(async () => {
        const stage = (name: string): BuildProducer => ({
          ...test.producer,
          values: { stage: name },
          async build(context) {
            const result = await test.producer.build(context);
            await writeFile(result.entry, `export default ${JSON.stringify(name)};`);
            return result;
          },
        });
        const [preview, production] = await Promise.all([
          createBuildContext().resolve(stage("preview")),
          createBuildContext().resolve(stage("production")),
        ]);
        expect(await readFile(preview.entry, "utf8")).toContain('"preview"');
        expect(await readFile(production.entry, "utf8")).toContain('"production"');
        expect(test.builds()).toBe(2);
      });
    }).pipe(Effect.scoped),
);

it.live("does not publish receipts for failed or concurrently edited builds", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.promise(async () => {
      const failed: BuildProducer = {
        ...test.producer,
        async build(context) {
          await test.producer.build(context);
          throw new Error("compiler failed");
        },
      };
      await expect(createBuildContext().resolve(failed)).rejects.toThrow("compiler failed");
      await createBuildContext().resolve(test.producer);
      expect(test.builds()).toBe(2);
      const edited: BuildProducer = {
        ...test.producer,
        values: { edit: true },
        async build(context) {
          const result = await test.producer.build(context);
          await writeFile(resolve(test.root, "source.txt"), "edited-during-build");
          return result;
        },
      };
      await expect(createBuildContext().resolve(edited)).rejects.toThrow(
        "inputs changed during compilation",
      );
      const result = await createBuildContext().resolve(test.producer);
      expect(await readFile(result.entry, "utf8")).toContain("edited-during-build");
      expect(test.builds()).toBe(4);
    });
  }).pipe(Effect.scoped),
);
