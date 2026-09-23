# Publishing Renkin

The public package is `@carere/renkin`; the executable is `renkin`. The first
version is `0.1.0-rc.1`, published with the npm `latest` tag intentionally. Its
GitHub release is still marked as a prerelease. These are independent settings.

## Prepare the first release

1. Merge the release changes into `main`. The workflow accepts `main` in
   `carere/renkin` only and reads the committed package version. It does not bump
   versions or push version commits. This first version is already set; do not
   run an automatic bump before releasing it.
2. Create the GitHub environment `npm`. Run **Release** (`release.yml`) on `main`
   with **publish unchecked**. Repository checks must pass, then one Linux-built
   tarball is installed and tested on both Linux and macOS. Both consumers verify
   its hash, clean source revision and lockfile identity.
3. Wait for the draft GitHub release `v0.1.0-rc.1`. It contains
   `renkin-0.1.0-rc.1.tgz` and `artifact.json`. Download both assets to the same
   directory. Compare `shasum -a 256 renkin-0.1.0-rc.1.tgz` with `sha256` in the
   identity record; verify the recorded source revision is the intended commit.
4. Run the separate installed-artifact Cloudflare acceptance against that tarball
   with its explicit resource scope, then audit cleanup. The workflow runs local
   validation only; skipped cloud tests or successful imports do not establish
   cloud acceptance. See the [installed cloud harness](../packages/renkin/tests/support/root/release/cloud/README.md).

The workflow takes its prepare/publish split from the Alchemy fork. Build and test
jobs have read-only repository permissions. Only the final release job can write
GitHub releases or request npm's OIDC identity. Source-workspace publication remains
guarded. Private implementation packages are assembled into the single artifact.

## Bootstrap npm

Use an npm account with publishing access to the `@carere` scope and complete npm's
interactive authentication. From the directory containing the downloaded assets:

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

## Subsequent releases

Use Cocogitto on clean `main` to choose the next version, update the changelog and
lockfile, and create the version commit/tag as described in the root README.
Push the version commit and its tag. Run **Release** on that commit with
**publish checked** after cloud acceptance. Any existing `v<version>` tag must
point to that exact commit. The workflow validates, drafts the GitHub release,
publishes the tarball under `latest`, and then publishes the GitHub release.
Dispatching is the release trigger; pushing a tag alone does not publish.

For a failed publishing job, rerun failed jobs to retain the original validated
artifact. Existing draft assets must match byte-for-byte and are never overwritten.
If npm succeeded but GitHub finalization failed, verify the npm version and finish
publishing the existing draft manually. For changed code, create a new version.
