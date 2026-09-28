import type {
  GitHubRelease,
  ReleaseAsset,
  ReleaseService,
} from "#src/contexts/root/services/release/github-release-service.ts";

export class InMemoryReleaseService implements ReleaseService {
  release: GitHubRelease | undefined;
  created: GitHubRelease = { id: 1, draft: true, assets: [] };
  bytes: Uint8Array = new Uint8Array();
  uploads: { name: string; bytes: Uint8Array }[] = [];
  discarded: number[] = [];
  publishCalls = 0;
  publishError: Error | undefined;
  async find() {
    return this.release;
  }
  async create() {
    return this.created;
  }
  async download() {
    return this.bytes;
  }
  async upload(_release: GitHubRelease, name: string, bytes: Uint8Array) {
    this.uploads.push({ name, bytes });
  }
  async discardIncomplete(asset: ReleaseAsset) {
    this.discarded.push(asset.id);
  }
  async publish() {
    this.publishCalls++;
    if (this.publishError) throw this.publishError;
  }
}
