import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import { Effect } from "effect";
import { defineStack } from "renkin";
import { appendInput, type Mode, reuseFixture } from "#test-support/root/build/reuse-fixture.ts";

type Fixture = Awaited<ReturnType<typeof reuseFixture>>;

const verifyCoalescing = async (fixture: Fixture) => {
  const result = await Effect.runPromise(
    prepareStack(
      defineStack({ name: "reuse", resources: [fixture.site("first"), fixture.site("second")] }),
    ),
  );
  expect(fixture.compilations()).toBe(1);
  expect(result.resources.find((resource) => resource.id === "first")?.properties).toMatchObject({
    requirements: { DATA: { id: "first-data" } },
  });
  expect(result.resources.find((resource) => resource.id === "second")?.properties).toMatchObject({
    requirements: { DATA: { id: "second-data" } },
  });
  const first = await fixture.build("first");
  const second = await fixture.build("second");
  expect(fixture.compilations()).toBe(1);
  expect(dirname(first.entry)).toBe(dirname(second.entry));
  expect(first.entry).not.toBe(second.entry);
  return first;
};

const verifyInputs = async (fixture: Fixture) => {
  for (const input of [
    fixture.shared,
    resolve(fixture.directory, "bun.lock"),
    fixture.configuration,
    resolve(fixture.root, "public/deployment.json"),
  ]) {
    const count = fixture.compilations();
    await appendInput(input);
    await fixture.build("first");
    expect(fixture.compilations()).toBe(count + 1);
  }
  const before = fixture.compilations();
  const production = await fixture.build("first", "production");
  expect(fixture.compilations()).toBe(before + 1);
  await fixture.build("first", "production");
  expect(fixture.compilations()).toBe(before + 1);
  return production;
};

const verifyMissingOutputs = async (fixture: Fixture) => {
  const dist = resolve(fixture.root, "dist");
  for (const suffix of ["deployment.json", "_headers"]) {
    const paths = await readdir(dist, { recursive: true });
    const path = paths.find((path) => path.endsWith(suffix));
    expect(path).toBeDefined();
    const count = fixture.compilations();
    await rm(resolve(dist, path ?? "missing"));
    await fixture.build("first", "production");
    expect(fixture.compilations()).toBe(count + 1);
  }
};

for (const mode of ["solid-spa", "solid-ssr", "astro-static", "astro-ssr"] satisfies Mode[]) {
  it(`${mode} reuses raw builds, isolates binding wrappers and invalidates real compilation inputs`, async () => {
    const fixture = await reuseFixture(mode);
    try {
      const first = await verifyCoalescing(fixture);
      const firstSource = await readFile(first.entry, "utf8");
      const production = await verifyInputs(fixture);
      expect(await readFile(first.entry, "utf8")).toBe(firstSource);
      if (mode !== "astro-static") {
        expect(production.auxiliaryFiles?.length).toBeGreaterThan(0);
        for (const file of production.auxiliaryFiles ?? [])
          expect(
            (await readFile(resolve(dirname(production.entry), file))).byteLength,
          ).toBeGreaterThan(0);
      }
      await verifyMissingOutputs(fixture);
    } finally {
      await fixture.close();
    }
  }, 180_000);
}
