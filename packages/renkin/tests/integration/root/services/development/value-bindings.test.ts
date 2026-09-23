import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineStack, development, resourceOutput, secret } from "@carere/renkin";
import { accessApplication, astro, tanstackStart, worker } from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import { frameworkBindings } from "@renkin/websites/models/framework-worker";
import { Effect } from "effect";
import { vi } from "vitest";

it.live(
  "makes secrets and explicit cloud-output substitutes available locally without embedding secrets in builds or state",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-local-values-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => vi.stubEnv("RENKIN_LOCAL_VALUE_TEST", "local-secret-value")),
        () => Effect.sync(() => vi.unstubAllEnvs()),
      );
      const entry = join(directory, "worker.mjs");
      yield* Effect.promise(() =>
        writeFile(
          entry,
          "export default {fetch(_request,env){return Response.json({auth:env.AUTH,audience:env.AUDIENCE})}}",
        ),
      );
      const access = accessApplication("access", { domain: "review.example.test" });
      const bindings = {
        AUTH: secret("RENKIN_LOCAL_VALUE_TEST"),
        AUDIENCE: resourceOutput(access, "aud", { local: "local-audience" }),
      };
      const stack = defineStack({
        name: "local-values",
        resources: [worker("worker", { entry, compatibilityDate: "2026-07-30", bindings }), access],
      });
      const built = yield* prepareStack(stack);
      expect(JSON.stringify(built)).not.toContain("local-secret-value");
      const running = yield* development(stack, { directory, watch: false });
      const localWorker = running.workers.worker;
      if (!localWorker) throw new Error("Local Worker did not start.");
      const response = yield* Effect.promise(() =>
        localWorker.fetch("/").then((response) => response.json()),
      );
      expect(response).toEqual({ auth: "local-secret-value", audience: "local-audience" });
      const persisted = yield* Effect.promise(() =>
        readFile(join(directory, "local-values/local.json"), "utf8"),
      );
      expect(persisted).not.toContain("local-secret-value");
      for (const site of [
        tanstackStart("start", {
          root: directory,
          rendering: "ssr",
          compatibilityDate: "2026-07-30",
          bindings,
        }),
        astro("astro", {
          root: directory,
          output: "server",
          compatibilityDate: "2026-07-30",
          bindings,
          sessionKVBindingName: false,
        }),
      ]) {
        expect(site.options.bindings).toEqual(bindings);
        expect(site.dependencies).toContain("access");
      }
      expect(frameworkBindings(bindings).requirements).toEqual({});
    }).pipe(Effect.scoped),
);
