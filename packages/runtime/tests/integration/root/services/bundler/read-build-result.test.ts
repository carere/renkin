import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { readBuildResult } from "#src/contexts/root/services/bundler/read-build-result.ts";

it.live("captures external modules and assets with ignore, header and redirect rules", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-build-"))),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    );
    yield* Effect.promise(async () => {
      await mkdir(join(directory, "public"));
      await writeFile(join(directory, "entry.mjs"), "export default {};");
      await writeFile(join(directory, "message.txt"), "module contents");
      for (const [name, contents] of Object.entries({
        "index.html": "<h1>site</h1>",
        ".assetsignore": "*.secret\n*.txt\n!public.txt\n",
        "private.secret": "excluded-secret",
        "private.txt": "excluded-text",
        "public.txt": "included-text",
        _headers: "/*\n  X-Test: yes\n",
        _redirects: "/old /new 302\n",
      }))
        await writeFile(join(directory, "public", name), contents);
    });
    const build = yield* Effect.promise(() =>
      readBuildResult({
        entry: join(directory, "entry.mjs"),
        modules: [{ path: "message.txt", type: "text/plain" }],
        assets: { directory: join(directory, "public") },
      }),
    );
    expect(Object.keys(build.assets?.files ?? {})).toEqual(["/index.html", "/public.txt"]);
    expect(build.assets?.config).toEqual({
      headers: "/*\n  X-Test: yes\n",
      redirects: "/old /new 302\n",
    });
    expect(Buffer.from(build.modules[0]?.content ?? "", "base64").toString()).toBe(
      "module contents",
    );
  }).pipe(Effect.scoped),
);
