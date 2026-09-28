import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { sha256File } from "#src/contexts/root/services/release/build-info.ts";
import { canonicalArtifact } from "#src/contexts/root/services/release/canonical-artifact.ts";
import { publishRelease } from "#src/contexts/root/services/release/publish-release.ts";
import { releaseCommand } from "#src/contexts/root/services/release/release-git.ts";
import { InMemoryReleaseService } from "#test-support/root/services/release/in-memory-release-service.ts";

const prepared = { version: "0.1.0-rc.2", source: "source", revision: "revision" };
const fixture = () =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const root = await mkdtemp(join(tmpdir(), "renkin-artifact-recovery-"));
      await writeFile(join(root, "bun.lock"), "locked dependencies");
      const directory = join(root, ".renkin/release");
      let builds = 0;
      const build = async () => {
        builds++;
        await mkdir(join(root, "package"), { recursive: true });
        await writeFile(
          join(root, "package/package.json"),
          JSON.stringify({ name: "@carere/renkin", version: prepared.version }),
        );
        const archive = join(directory, `renkin-${prepared.version}.tgz`);
        await releaseCommand(root, "tar", ["-czf", archive, "package"]);
        await writeFile(
          join(directory, "artifact.json"),
          JSON.stringify({
            sha256: await sha256File(archive),
            source: {
              sourceRevision: prepared.revision,
              sourceDirty: false,
              lockSha256: await sha256File(join(root, "bun.lock")),
            },
          }),
        );
      };
      return { root, directory, build, builds: () => builds };
    }),
    ({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  );

it.live(
  "restores exactly the checkpointed tarball after validation failure without rebuilding",
  () =>
    Effect.gen(function* () {
      const fixtureValue = yield* fixture();
      const { root, directory, build } = fixtureValue;
      const host = new InMemoryReleaseService();
      const archive = yield* Effect.promise(() => canonicalArtifact(root, prepared, host, build));
      const original = yield* Effect.promise(() => readFile(archive));
      const uploaded = host.uploads[0];
      if (!uploaded) throw new Error("Canonical bundle was not uploaded.");
      host.release = {
        id: 1,
        draft: true,
        assets: [{ id: 1, name: uploaded.name, state: "uploaded" }],
      };
      host.bytes = uploaded.bytes;
      yield* Effect.promise(() => rm(directory, { force: true, recursive: true }));
      yield* Effect.promise(() => canonicalArtifact(root, prepared, host, build));
      expect(yield* Effect.promise(() => readFile(archive))).toEqual(original);
      expect(fixtureValue.builds()).toBe(1);
      expect(host.uploads).toHaveLength(1);
      yield* Effect.promise(() =>
        expect(
          canonicalArtifact(root, { ...prepared, revision: "wrong" }, host, build),
        ).rejects.toThrow("identity"),
      );
    }).pipe(Effect.scoped),
);

it.live(
  "can replace an incomplete upload but never silently rebuilds completed release assets",
  () =>
    Effect.gen(function* () {
      const { root, build } = yield* fixture();
      const host = new InMemoryReleaseService();
      host.release = {
        id: 1,
        draft: true,
        assets: [{ id: 1, name: `renkin-${prepared.version}-bundle.tar`, state: "starter" }],
      };
      yield* Effect.promise(() => canonicalArtifact(root, prepared, host, build));
      expect(host.discarded).toEqual([1]);
      host.release = {
        id: 1,
        draft: true,
        assets: [{ id: 2, name: "other.tgz", state: "uploaded" }],
      };
      yield* Effect.promise(() =>
        expect(canonicalArtifact(root, prepared, host, build)).rejects.toThrow(
          "refusing to rebuild",
        ),
      );
    }).pipe(Effect.scoped),
);

it.live("resumes npm success after GitHub failure and rejects registry integrity mismatches", () =>
  Effect.gen(function* () {
    const { root, build } = yield* fixture();
    const host = new InMemoryReleaseService();
    const archive = yield* Effect.promise(() => canonicalArtifact(root, prepared, host, build));
    host.release = host.created;
    host.publishError = new Error("GitHub unavailable");
    let publishCalls = 0;
    const registry = {
      integrity: async (): Promise<string | undefined> => undefined,
      publish: async () => {
        publishCalls++;
      },
    };
    yield* Effect.promise(() =>
      expect(publishRelease(prepared, archive, host, registry)).rejects.toThrow(
        "GitHub unavailable",
      ),
    );
    expect(publishCalls).toBe(1);
    const hash = createHash("sha512")
      .update(yield* Effect.promise(() => readFile(archive)))
      .digest("base64");
    registry.integrity = async () => `sha512-${hash}`;
    host.publishError = undefined;
    yield* Effect.promise(() => publishRelease(prepared, archive, host, registry));
    expect(publishCalls).toBe(1);
    expect(host.publishCalls).toBe(2);
    registry.integrity = async () => "sha512-different";
    yield* Effect.promise(() =>
      expect(publishRelease(prepared, archive, host, registry)).rejects.toThrow(
        "different artifact",
      ),
    );
    expect(host.publishCalls).toBe(2);
  }).pipe(Effect.scoped),
);
