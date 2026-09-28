import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { githubReleaseService } from "#src/contexts/root/services/release/github-release-service.ts";

afterEach(() => vi.unstubAllGlobals());

it.live("finds a canonical draft beyond the first page when tag lookup returns 404", () =>
  Effect.gen(function* () {
    const draft = { id: 42, tag_name: "v0.1.0-rc.2", draft: true, assets: [] };
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json(
          Array.from({ length: 100 }, (_, id) => ({
            id,
            tag_name: `v0.0.${id}`,
            draft: false,
            assets: [],
          })),
        ),
      )
      .mockResolvedValueOnce(Response.json([draft]));
    vi.stubGlobal("fetch", request);
    expect(yield* githubReleaseService("carere/renkin", "test").find(draft.tag_name)).toEqual(
      draft,
    );
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/carere/renkin/releases/tags/v0.1.0-rc.2",
      "https://api.github.com/repos/carere/renkin/releases?per_page=100&page=1",
      "https://api.github.com/repos/carere/renkin/releases?per_page=100&page=2",
    ]);
  }),
);

it.live("returns undefined only after the release list is exhausted", () =>
  Effect.gen(function* () {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(Response.json([])),
    );
    expect(yield* githubReleaseService("carere/renkin", "test").find("v1.0.0")).toBeUndefined();
  }),
);

it.live("keeps permission errors instead of treating them as missing drafts", () =>
  Effect.gen(function* () {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response(null, { status: 403 })),
    );
    const error = yield* Effect.flip(githubReleaseService("carere/renkin", "test").find("v1.0.0"));
    expect(error.message).toContain("403");
  }),
);
