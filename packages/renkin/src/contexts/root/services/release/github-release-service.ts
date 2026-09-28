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
  find(tag: string): Promise<GitHubRelease | undefined>;
  create(tag: string, revision: string): Promise<GitHubRelease>;
  download(asset: ReleaseAsset): Promise<Uint8Array>;
  upload(release: GitHubRelease, name: string, bytes: Uint8Array): Promise<void>;
  discardIncomplete(asset: ReleaseAsset): Promise<void>;
  publish(release: GitHubRelease): Promise<void>;
}

export const githubReleaseService = (repository: string, token: string): ReleaseService => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
    throw new Error("GitHub release credentials are missing.");
  const api = `https://api.github.com/repos/${repository}`;
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`GitHub release request failed (${response.status}).`);
    return response;
  };
  const json = async (url: string, init?: RequestInit) => {
    const response = await request(url, init);
    if (response.status === 404) throw new Error("GitHub release resource is missing.");
    return response.json();
  };
  return {
    find: async (tag) => {
      const response = await request(`${api}/releases/tags/${encodeURIComponent(tag)}`);
      return response.status === 404 ? undefined : response.json();
    },
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
    download: async (asset) => {
      const response = await request(`${api}/releases/assets/${asset.id}`, {
        headers: { Accept: "application/octet-stream" },
      });
      if (response.status === 404) throw new Error("Canonical release asset is missing.");
      return new Uint8Array(await response.arrayBuffer());
    },
    upload: async (release, name, bytes) => {
      await json(
        `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: Buffer.from(bytes),
        },
      );
    },
    discardIncomplete: async (asset) => {
      if (asset.state === "uploaded") throw new Error("Cannot replace a completed release asset.");
      await request(`${api}/releases/assets/${asset.id}`, { method: "DELETE" });
    },
    publish: async (release) => {
      await json(`${api}/releases/${release.id}`, {
        method: "PATCH",
        body: JSON.stringify({ draft: false }),
      });
    },
  };
};
