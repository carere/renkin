import { appendFile, readFile } from "node:fs/promises";
import {
  canonicalArtifact,
  verifyCanonicalArtifact,
} from "#src/contexts/root/services/release/canonical-artifact.ts";
import { githubReleaseService } from "#src/contexts/root/services/release/github-release-service.ts";
import {
  type PreparedRelease,
  prepareRelease,
} from "#src/contexts/root/services/release/prepare-release.ts";
import { publishRelease } from "#src/contexts/root/services/release/publish-release.ts";
import { releaseCommand } from "#src/contexts/root/services/release/release-git.ts";

const root = process.cwd();
const host = githubReleaseService(process.env.GITHUB_REPOSITORY ?? "", process.env.GH_TOKEN ?? "");
const command = process.argv[2];
if (command === "prepare") {
  const prepared = await prepareRelease(root, {
    runId: process.env.GITHUB_RUN_ID ?? "",
    requested: process.env.REQUESTED_VERSION ?? "",
  });
  const release = await host.find(`v${prepared.version}`);
  const skip = release?.draft === false;
  await appendFile(
    process.env.GITHUB_OUTPUT ?? "",
    `version=${prepared.version}\nrevision=${prepared.revision}\nsource=${prepared.source}\nskip=${skip}\n`,
  );
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY ?? "",
    skip
      ? `Version ${prepared.version} is already released. No new release is needed.\n`
      : `Preparing ${prepared.version} from source ${prepared.source}, release commit ${prepared.revision}.\n`,
  );
} else if (command === "pack" || command === "publish") {
  const manifest = JSON.parse(await readFile("packages/renkin/package.json", "utf8"));
  const prepared: PreparedRelease = {
    version: manifest.version,
    revision: process.env.RELEASE_REVISION ?? "",
    source: process.env.RELEASE_SOURCE ?? "",
  };
  if (command === "pack") {
    await canonicalArtifact(root, prepared, host, async () => {
      await releaseCommand(root, process.execPath, [
        "--no-env-file",
        "packages/renkin/release.ts",
        "pack",
      ]);
    });
  } else {
    const archive = await verifyCanonicalArtifact(root, prepared);
    await publishRelease(prepared, archive, host, {
      integrity: async (version) => {
        const response = await fetch(
          `https://registry.npmjs.org/@carere%2frenkin/${encodeURIComponent(version)}`,
        );
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`npm version lookup failed (${response.status}).`);
        const record = await response.json();
        if (typeof record.dist?.integrity !== "string")
          throw new Error("npm version is missing artifact integrity.");
        return record.dist.integrity;
      },
      publish: async (file) => {
        await releaseCommand(root, "npm", [
          "publish",
          file,
          "--registry",
          "https://registry.npmjs.org",
          "--access",
          "public",
          "--tag",
          "latest",
        ]);
      },
    });
  }
} else throw new Error("Use release-workflow.ts prepare, pack or publish.");
