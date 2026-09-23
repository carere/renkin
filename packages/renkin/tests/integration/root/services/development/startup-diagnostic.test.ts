import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { defineStack, development } from "@carere/renkin";
import { tanstackStart, worker } from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

it.live(
  "reports the failing startup phase without exposing builder messages or nested secrets",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-startup-diagnostic-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      );
      const diagnosticLog = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(console, "error").mockImplementation(() => {})),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const failure = Object.assign(
        new Error("SECRET_MESSAGE", {
          cause: Object.assign(new Error("SECRET_CAUSE"), { code: "EADDRINUSE" }),
        }),
        {
          name: "SECRET_NAME",
          code: "SECRET_CODE",
          stage: "SECRET_STAGE",
          stack:
            "TypeError: SECRET_MESSAGE\n at hidden (/SECRET_PATH/private.ts:1:2)\n at secretFunction (/SECRET_PATH/node_modules/vite/dist/node/chunks/node.js:123:45)",
        },
      );
      const resource = worker("Site", {
        compatibilityDate: "2026-07-30",
        builder: {
          build: async () => {
            throw failure;
          },
          develop: async () => {
            throw failure;
          },
        },
      });
      const result = yield* development(
        defineStack({ name: "diagnostic", resources: [resource] }),
        { directory },
      ).pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }));
      expect(result?.message).toBe("Local application startup failed.");
      expect(result?.cause).toEqual({
        phase: "frameworks",
        failures: [
          { name: "unknown", locations: [{ module: "vite", line: 123, column: 45 }] },
          { name: "Error", code: "EADDRINUSE" },
        ],
      });
      expect(inspect(result)).not.toContain("SECRET_");
      expect(diagnosticLog).toHaveBeenCalledWith(
        `[renkin:startup] ${JSON.stringify(result?.cause)}`,
      );
      expect(JSON.stringify(diagnosticLog.mock.calls)).not.toContain("SECRET_");
      // Cleanup released the lease: a later attempt reaches its own failure stage.
      const entry = join(directory, "invalid.mjs");
      yield* Effect.promise(() => writeFile(entry, "export default {"));
      const subsequent = yield* development(
        defineStack({
          name: "diagnostic",
          resources: [worker("Site", { entry, compatibilityDate: "2026-07-30" })],
        }),
        { directory },
      ).pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }));
      expect(subsequent?.cause).toMatchObject({ phase: "prepare-stack" });
    }).pipe(Effect.scoped),
);

it.live("prints sanitized startup context on child stderr while leaving stdout empty", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-startup-child-"))),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    );
    const script = `import {Effect} from "effect";
import {defineStack,development} from "@carere/renkin";
import {worker} from "@carere/renkin/cloudflare";
const fail=async()=>{throw Object.assign(new Error("SECRET_MESSAGE"),{code:"EADDRINUSE"})};
const resource=worker("Site",{compatibilityDate:"2026-07-30",builder:{build:fail,develop:fail}});
await Effect.runPromise(Effect.scoped(development(defineStack({name:"child",resources:[resource]}),{directory:process.argv[1]})));`;
    const child = spawnSync("bun", ["--no-env-file", "-e", script, directory], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10000,
    });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    const diagnostic = child.stderr
      .split("\n")
      .find((line) => line.startsWith("[renkin:startup] "));
    expect(diagnostic).toBe(
      '[renkin:startup] {"phase":"frameworks","failures":[{"name":"Error","code":"EADDRINUSE"}]}',
    );
    expect(child.stderr).toContain("Local application startup failed.");
    expect(child.stderr).not.toContain("SECRET_");
  }).pipe(Effect.scoped),
);

it.live(
  "identifies actual Vite configuration startup failure through the public framework recipe",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-vite-diagnostic-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      );
      yield* Effect.promise(() =>
        writeFile(
          join(directory, "vite.config.mjs"),
          'export default {plugins:[{name:"failing-user-plugin",configureServer(){throw new TypeError("PRIVATE_PLUGIN_MESSAGE")}}]};',
        ),
      );
      const diagnostics = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(console, "error").mockImplementation(() => {})),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const site = tanstackStart("Site", {
        root: directory,
        rendering: "spa",
        compatibilityDate: "2026-07-30",
      });
      const result = yield* development(
        defineStack({ name: "vite-diagnostic", resources: [site] }),
        { directory: join(directory, "state") },
      ).pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }));
      expect(result?.cause).toMatchObject({
        phase: "frameworks",
        failures: [{ name: "Error", stage: "create-vite-server" }, { name: "TypeError" }],
      });
      const detail = result?.cause as { failures: { locations?: { module: string }[] }[] };
      expect(detail.failures[1]?.locations?.some((location) => location.module === "vite")).toBe(
        true,
      );
      const logged = diagnostics.mock.calls.filter(
        ([line]) => typeof line === "string" && line.startsWith("[renkin:startup]"),
      );
      expect(logged).toHaveLength(1);
      expect(JSON.stringify(logged)).not.toContain("PRIVATE_");
      expect(JSON.stringify(logged)).not.toContain(directory);
    }).pipe(Effect.scoped),
);
