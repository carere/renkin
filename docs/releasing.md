# Publishing Renkin

The public package is `@carere/renkin`; the executable is `renkin`. The first
version is `0.1.0-rc.1`, published with the npm `latest` tag intentionally. Its
GitHub release is still marked as a prerelease. These are independent settings.

## Run a release

Run **Release** (`release.yml`) on `main` in `carere/renkin`:

| Input | Behavior |
| --- | --- |
| **version** empty | Cocogitto increments the current prerelease number without changing its stage/base; stable versions follow the repository's Conventional Commit rules. |
| **version** provided | Use this exact SemVer if it is strictly newer than every reserved release version. Equal/older versions and malformed values fail before reservation. |
| **publish** unchecked | Prepare and validate a draft containing the canonical release bundle. |
| **publish** checked | Validate, publish the tarball to npm under `latest`, and publish the GitHub release. |

Examples: `0.1.0-alpha.1` automatically becomes `0.1.0-alpha.2`; moving to
`0.1.0-beta.1`, `0.1.0-rc.1` or `0.1.0` requires an explicit version. Once stable,
Cocogitto chooses patch/minor/major according to commit history and the pre-1.0
rules in `cog.toml`. Build metadata alone does not make an explicit version newer.
Automatic prereleases need a numeric final identifier, such as `rc.1`.

## Version and artifact identity

The workflow fetches current `main` and release tags. Cocogitto creates a release
commit containing the version, unchanged dependency resolutions and cumulative
changelog. Release ancestry includes the previous release so previously released
features are not counted again. A `.release-source.json` marker records the exact
source commit. These generated commits live in tagged release history, never on
protected `main`; the development manifest may therefore retain an older version.
No manual bump PR, main-branch bypass token or protection-rule change is needed.

An atomic push reserves `v<version>` and `release-run-<run-id>`. The run tag pins
retries even if more commits have since reached main. These tags are durable
release checkpoints: do not delete or move them. Versions are chosen against all
reserved tags, including unpublished candidates. The existing initial release
tag is the starting baseline; bootstrapping an entirely new repository is not
part of this workflow.

Every subsequent job checks out the generated release commit. Static/local tests
run on it; one tarball is then built and installed/tested on Linux and macOS.
Packing saves `renkin-<version>-bundle.tar` in a draft GitHub release. This single
asset contains the tarball and `artifact.json` together, so a retry cannot pair
one build's tarball with another build's identity. The draft may exist before
validation finishes and must not be published manually until validation passes.
The workflow summary confirms completion when **publish** is off.

Build/check jobs need read permissions. Preparation can create tags, packing can
create draft assets, and the final job has release-write and npm OIDC permissions.
The normal GitHub token suffices because the workflow does not push main.

The workflow performs local validation only. Before approving publication, run
the separate installed-artifact Cloudflare acceptance with its explicit resource
scope and audit cleanup. Successful imports or local emulation do not establish
cloud acceptance; see the [installed cloud harness](../packages/renkin/tests/support/root/release/cloud/README.md).

## Retry or finish a release

- **Rerun failed jobs** to resume the same version. Rerunning all jobs also reuses
  the run checkpoint and completed canonical bundle; it does not bump again.
- A new run with version empty and unchanged main resumes the current candidate.
  This lets you validate with **publish** off, then run again with it on.
- If main gained changes, a new dispatch creates the next version. To finish an
  older candidate, rerun its original run rather than entering the old version.
- If nothing changed and the candidate is already published, the run succeeds
  with an “already released” summary and skips building/publishing.
- If npm succeeded but GitHub finalization failed, retrying compares npm's
  recorded SHA-512 integrity with the canonical tarball, skips npm publication
  when they match, and completes GitHub finalization. A mismatch fails closed.
- Completed canonical assets are never replaced. Incomplete GitHub upload stubs
  may be discarded and retried. Missing/expired Actions artifacts can be restored
  by rerunning all jobs: the canonical bundle remains in the draft release.

The **release** concurrency group serializes release runs. Normal work can continue
on main while a pinned release is being validated.

## Bootstrap npm

Use an npm account with publishing access to the `@carere` scope and complete npm's
interactive authentication. For newer workflow drafts, download and extract the canonical bundle first; it
contains both the `.tgz` and `artifact.json`. From that directory:

```sh
npm login
npm whoami
npm publish ./renkin-0.1.0-rc.1.tgz --registry https://registry.npmjs.org --access public --tag latest --dry-run
npm publish ./renkin-0.1.0-rc.1.tgz --registry https://registry.npmjs.org --access public --tag latest
npm view @carere/renkin@0.1.0-rc.1 version dist.integrity
npm view @carere/renkin dist-tags
```

After successful npm publication, publish the existing GitHub draft. Keep its
prerelease marker. Do not run the OIDC workflow to republish this version: npm
versions are immutable. Install the release in Delimoov with
`bun add --exact @carere/renkin@0.1.0-rc.1 effect@4.0.0-rc.115`, aligning its other
Effect dependencies with the same compatible runtime.

## Enable trusted publishing

In the npm package's trusted publisher settings, select GitHub Actions:

| Field | Value |
| --- | --- |
| Organization or user | `carere` |
| Repository | `renkin` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | Direct `npm publish` |

The publishing job uses a GitHub-hosted runner, Node 24, npm 11.16.0 and
`id-token: write`. It needs no npm token secret. npm automatically supplies
provenance for OIDC publication. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
