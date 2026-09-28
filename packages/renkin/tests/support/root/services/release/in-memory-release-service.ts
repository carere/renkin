import { Effect } from "effect";
import type {
  GitHubRelease,
  ReleaseAsset,
  ReleaseService,
} from "#src/contexts/root/services/release/github-release-service.ts";
import { ReleaseError } from "#src/contexts/root/services/release/release-error.ts";

export class InMemoryReleaseService implements ReleaseService {
  release: GitHubRelease | undefined;
  created: GitHubRelease = { id: 1, draft: true, assets: [] };
  bytes: Uint8Array = new Uint8Array();
  uploads: { name: string; bytes: Uint8Array }[] = [];
  discarded: number[] = [];
  publishCalls = 0;
  publishError: Error | undefined;
  find = () => Effect.sync(() => this.release);
  create = () => Effect.sync(() => this.created);
  download = () => Effect.sync(() => this.bytes);
  upload = (_release: GitHubRelease, name: string, bytes: Uint8Array) =>
    Effect.sync(() => {
      this.uploads.push({ name, bytes });
    });
  discardIncomplete = (asset: ReleaseAsset) =>
    Effect.sync(() => {
      this.discarded.push(asset.id);
    });
  publish = () =>
    Effect.suspend(() => {
      this.publishCalls++;
      return this.publishError
        ? Effect.fail(new ReleaseError(this.publishError.message))
        : Effect.void;
    });
}
