import { appendFile, readFile } from "node:fs/promises";
import { Effect } from "effect";
import {
  canonicalArtifact,
  verifyCanonicalArtifact,
} from "#src/contexts/root/services/release/canonical-artifact.ts";
import { githubReleaseService } from "#src/contexts/root/services/release/github-release-service.ts";
import { npmPackageRegistry } from "#src/contexts/root/services/release/npm-package-registry.ts";
import {
  type PreparedRelease,
  prepareRelease,
} from "#src/contexts/root/services/release/prepare-release.ts";
import { publishRelease } from "#src/contexts/root/services/release/publish-release.ts";
import { releaseAttempt } from "#src/contexts/root/services/release/release-error.ts";
import { releaseCommand } from "#src/contexts/root/services/release/release-git.ts";

await Effect.runPromise(
  Effect.gen(function* () {
    const root = process.cwd();
    const host = githubReleaseService(
      process.env.GITHUB_REPOSITORY ?? "",
      process.env.GH_TOKEN ?? "",
    );
    const command = process.argv[2];
    if (command === "prepare") {
      const prepared = yield* prepareRelease(root, {
        runId: process.env.GITHUB_RUN_ID ?? "",
        requested: process.env.REQUESTED_VERSION ?? "",
      });
      const release = yield* host.find(`v${prepared.version}`);
      const skip = release?.draft === false;
      yield* releaseAttempt(() =>
        appendFile(
          process.env.GITHUB_OUTPUT ?? "",
          `version=${prepared.version}\nrevision=${prepared.revision}\nsource=${prepared.source}\nskip=${skip}\n`,
        ),
      );
      yield* releaseAttempt(() =>
        appendFile(
          process.env.GITHUB_STEP_SUMMARY ?? "",
          skip
            ? `Version ${prepared.version} is already released. No new release is needed.\n`
            : `Preparing ${prepared.version} from source ${prepared.source}, release commit ${prepared.revision}.\n`,
        ),
      );
    } else if (command === "pack" || command === "publish") {
      const manifest = JSON.parse(
        yield* releaseAttempt(() => readFile("packages/renkin/package.json", "utf8")),
      );
      const prepared: PreparedRelease = {
        version: manifest.version,
        revision: process.env.RELEASE_REVISION ?? "",
        source: process.env.RELEASE_SOURCE ?? "",
      };
      if (command === "pack") {
        yield* canonicalArtifact(root, prepared, host, () =>
          Effect.gen(function* () {
            yield* releaseCommand(root, process.execPath, [
              "--no-env-file",
              "packages/renkin/release.ts",
              "pack",
            ]);
          }),
        );
      } else {
        const archive = yield* verifyCanonicalArtifact(root, prepared);
        yield* publishRelease(prepared, archive, host, npmPackageRegistry(root));
      }
    } else throw new Error("Use release-workflow.ts prepare, pack or publish.");
  }),
);
