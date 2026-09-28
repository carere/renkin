import { Effect } from "effect";
import { ReleaseError, releaseAttempt } from "./release-error.ts";
import { parseVersion } from "./version.ts";
export interface ReleaseAsset {
  readonly id: number;
  readonly name: string;
  readonly state: string;
}
export interface GitHubRelease {
  readonly id: number;
  readonly draft: boolean;
  readonly assets: readonly ReleaseAsset[];
}
export interface ReleaseService {
  find(tag: string): Effect.Effect<GitHubRelease | undefined, ReleaseError>;
  create(tag: string, revision: string): Effect.Effect<GitHubRelease, ReleaseError>;
  download(asset: ReleaseAsset): Effect.Effect<Uint8Array, ReleaseError>;
  upload(
    release: GitHubRelease,
    name: string,
    bytes: Uint8Array,
  ): Effect.Effect<void, ReleaseError>;
  discardIncomplete(asset: ReleaseAsset): Effect.Effect<void, ReleaseError>;
  publish(release: GitHubRelease): Effect.Effect<void, ReleaseError>;
}

const githubRequests = (token: string) => {
  const request = (url: string, init: RequestInit = {}) =>
    Effect.gen(function* () {
      const response = yield* releaseAttempt((signal) =>
        fetch(url, {
          signal,
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...init.headers,
          },
        }),
      );
      if (!response.ok && response.status !== 404)
        return yield* Effect.fail(
          new ReleaseError(`GitHub release request failed (${response.status}).`),
        );
      return response;
    });
  const json = (url: string, init?: RequestInit) =>
    Effect.gen(function* () {
      const response = yield* request(url, init);
      if (response.status === 404)
        return yield* Effect.fail(new ReleaseError("GitHub release resource is missing."));
      return yield* releaseAttempt(() => response.json());
    });
  return { request, json };
};
export const githubReleaseService = (repository: string, token: string): ReleaseService => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
    throw new Error("GitHub release credentials are missing.");
  const api = `https://api.github.com/repos/${repository}`;
  const { request, json } = githubRequests(token);
  return {
    find: (tag) =>
      Effect.gen(function* () {
        const response = yield* request(`${api}/releases/tags/${encodeURIComponent(tag)}`);
        return response.status === 404 ? undefined : yield* releaseAttempt(() => response.json());
      }),
    create: (tag, revision) =>
      json(`${api}/releases`, {
        method: "POST",
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: revision,
          name: tag,
          draft: true,
          prerelease: parseVersion(tag.slice(1)).pre.length > 0,
          generate_release_notes: true,
        }),
      }),
    download: (asset) =>
      Effect.gen(function* () {
        const response = yield* request(`${api}/releases/assets/${asset.id}`, {
          headers: { Accept: "application/octet-stream" },
        });
        if (response.status === 404)
          return yield* Effect.fail(new ReleaseError("Canonical release asset is missing."));
        return new Uint8Array(yield* releaseAttempt(() => response.arrayBuffer()));
      }),
    upload: (release, name, bytes) =>
      Effect.gen(function* () {
        yield* json(
          `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
          {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: Buffer.from(bytes),
          },
        );
      }),
    discardIncomplete: (asset) =>
      Effect.gen(function* () {
        if (asset.state === "uploaded")
          return yield* Effect.fail(new ReleaseError("Cannot replace a completed release asset."));
        yield* request(`${api}/releases/assets/${asset.id}`, { method: "DELETE" });
      }),
    publish: (release) =>
      Effect.gen(function* () {
        yield* json(`${api}/releases/${release.id}`, {
          method: "PATCH",
          body: JSON.stringify({ draft: false }),
        });
      }),
  };
};
