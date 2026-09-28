import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { prepareRelease } from "#src/contexts/root/services/release/prepare-release.ts";
import { gitFixture } from "#test-support/root/services/release/git-fixture.ts";

it.live(
  "increments RCs with Cocogitto, pins retries across newer main commits, and never pushes main",
  () =>
    Effect.gen(function* () {
      const fixture = yield* gitFixture();
      const source = yield* Effect.promise(() => fixture.change("feat: feature"));
      const root = yield* Effect.promise(fixture.checkout);
      const first = yield* prepareRelease(root, { runId: "1" });
      expect(first.version).toBe("0.1.0-rc.2");
      expect(first.source).toBe(source);
      expect(yield* Effect.promise(() => fixture.command(root, "rev-parse", "origin/main"))).toBe(
        source,
      );
      const lock = yield* Effect.promise(() => readFile(join(root, "bun.lock"), "utf8"));
      expect(lock).toContain('"untouched":["dependency@1.0.0"]');
      expect(lock).toContain('"version": "0.1.0-rc.2"');
      const resumed = yield* prepareRelease(yield* Effect.promise(fixture.checkout), {
        runId: "2",
      });
      expect(resumed).toEqual(first);
      yield* Effect.promise(() => fixture.change());
      const retry = yield* prepareRelease(yield* Effect.promise(fixture.checkout), { runId: "1" });
      expect(retry).toEqual(first);
      const next = yield* prepareRelease(yield* Effect.promise(fixture.checkout), { runId: "3" });
      expect(next.version).toBe("0.1.0-rc.3");
    }).pipe(Effect.scoped),
);

it.live(
  "uses explicit versions for alpha, beta, RC and stable transitions and refuses old or equal versions",
  () =>
    Effect.gen(function* () {
      const fixture = yield* gitFixture("1.0.0-alpha.1");
      for (const [index, requested] of ["1.0.0-beta.1", "1.0.0-rc.1", "1.0.0"].entries()) {
        const release = yield* prepareRelease(yield* Effect.promise(fixture.checkout), {
          runId: String(index + 1),
          requested,
        });
        expect(release.version).toBe(requested);
      }
      for (const requested of ["1.0.0", "1.0.0-rc.9", "0.9.0"]) {
        const failed = yield* Effect.promise(async () => {
          const root = await fixture.checkout();
          return Effect.runPromise(prepareRelease(root, { runId: "5", requested })).catch(
            (error: Error) => error.message,
          );
        });
        expect(failed).toContain("must be newer");
      }
    }).pipe(Effect.scoped),
);

it.live("uses stable Conventional Commit rules and excludes already released features", () =>
  Effect.gen(function* () {
    const fixture = yield* gitFixture("1.0.0");
    for (const [index, [message, version]] of [
      ["fix: patch", "1.0.1"],
      ["feat: feature", "1.1.0"],
      ["fix: patch again", "1.1.1"],
      ["docs: clarify usage", "1.1.2"],
    ].entries()) {
      yield* Effect.promise(() => fixture.change(message));
      const release = yield* prepareRelease(yield* Effect.promise(fixture.checkout), {
        runId: String(index + 1),
      });
      expect(release.version).toBe(version);
    }
  }).pipe(Effect.scoped),
);

it.live("does not reserve half a release when an atomic tag push is rejected", () =>
  Effect.gen(function* () {
    const fixture = yield* gitFixture();
    yield* Effect.promise(() => fixture.change());
    const hook = join(fixture.remote, "hooks/pre-receive");
    yield* Effect.promise(() =>
      writeFile(
        hook,
        '#!/bin/sh\nwhile read old new ref; do\n case "$ref" in refs/tags/release-run-*) exit 1;; esac\ndone\n',
        { mode: 0o755 },
      ),
    );
    const root = yield* Effect.promise(fixture.checkout);
    yield* Effect.promise(() =>
      expect(Effect.runPromise(prepareRelease(root, { runId: "8" }))).rejects.toThrow(),
    );
    expect(
      yield* Effect.promise(() =>
        fixture.command(root, "ls-remote", "--tags", "origin", "v0.1.0-rc.2", "release-run-8"),
      ),
    ).toBe("");
    yield* Effect.promise(() => unlink(hook));
    const retry = yield* prepareRelease(yield* Effect.promise(fixture.checkout), { runId: "8" });
    expect(retry.version).toBe("0.1.0-rc.2");
  }).pipe(Effect.scoped),
);

it.live("increments pre-1.0 stable patches with Cocogitto", () =>
  Effect.gen(function* () {
    const fixture = yield* gitFixture("0.0.1");
    for (const [index, version] of ["0.0.2", "0.0.3"].entries()) {
      yield* Effect.promise(() => fixture.change());
      const release = yield* prepareRelease(yield* Effect.promise(fixture.checkout), {
        runId: String(index + 1),
      });
      expect(release.version).toBe(version);
    }
  }).pipe(Effect.scoped),
);
