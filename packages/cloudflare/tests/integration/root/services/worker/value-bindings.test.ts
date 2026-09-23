import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { createAccessClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/access-client";
import { createCloudflareClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import { type Json, output } from "@renkin/core/models/stack";
import { emptyState } from "@renkin/core/models/state";
import { resourceOutput, secret } from "@renkin/core/models/value";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import { deploy } from "@renkin/core/use-cases/deploy";
import { plan } from "@renkin/core/use-cases/plan";
import { Effect } from "effect";
import { vi } from "vitest";
import { accessApplication } from "#src/contexts/root/models/access.ts";
import { worker } from "#src/contexts/root/models/worker.ts";
import { cloudflareAccessServices } from "#src/contexts/root/services/access/cloudflare-access-service.ts";
import { cloudflareWorkerService } from "#src/contexts/root/services/worker/cloudflare-worker-service.ts";
import { bindingHttp } from "#test-support/root/services/worker/binding-http.ts";

const setup = () =>
  Effect.gen(function* () {
    const fixture = yield* bindingHttp();
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "renkin-values-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => vi.stubEnv("RENKIN_BINDING_TEST", "secret-first")),
      () => Effect.sync(() => vi.unstubAllEnvs()),
    );
    const access = accessApplication("access", { name: "review", domain: "review.example.test" });
    const declared = worker("worker", {
      compatibilityDate: "2026-07-30",
      bindings: {
        ACCESS_AUDIENCE: resourceOutput(access, "aud"),
        AUTH: secret("RENKIN_BINDING_TEST"),
        PLAIN: "literal",
      },
    });
    const prepared = {
      ...declared,
      properties: {
        ...(declared.properties as Record<string, Json>),
        source: "export default {fetch(){return new Response('ok')}}",
      },
    };
    const stack = {
      name: "app",
      resources: [prepared, access],
      outputs: { audience: output(resourceOutput(access, "aud")) },
    };
    const progress: unknown[] = [];
    const options = {
      environment: "test",
      state: new FileStateRepository(directory),
      yes: true,
      progress: (change: unknown) => progress.push(change),
      services: () => ({
        ...cloudflareAccessServices({
          client: createAccessClient(fixture.config, fixture.gateway),
          token: "lease",
        }),
        "cloudflare.worker": cloudflareWorkerService({
          client: createCloudflareClient(fixture.config, fixture.gateway),
          siteClient: createSiteClient(fixture.config, fixture.gateway),
          token: "lease",
          stack: "app",
          environment: "test",
          subdomain: "test",
        }),
      }),
    };
    return { fixture, directory, stack, options, progress, access, prepared };
  });

it.live(
  "resolves generated audiences in order, refreshes changed bindings, and keeps env secrets out of state and diagnostics",
  () =>
    Effect.gen(function* () {
      const { fixture, directory, stack, options, progress, access, prepared } = yield* setup();
      expect(plan(stack, emptyState("app", "test")).map((item) => item.id)).toEqual([
        "access",
        "worker",
      ]);
      expect(() =>
        plan(
          { ...stack, resources: [prepared, { ...access, dependencies: ["worker"] }] },
          emptyState("app", "test"),
        ),
      ).toThrow("cycle");
      const state = yield* deploy(stack, options);
      expect(state.outputs.audience).toEqual({ value: "generated-audience", secret: false });
      expect(fixture.uploads).toHaveLength(1);
      expect(fixture.uploads[0]?.bindings).toEqual([
        { name: "ACCESS_AUDIENCE", type: "plain_text", text: "generated-audience" },
        { name: "AUTH", type: "secret_text", text: "secret-first" },
        { name: "PLAIN", type: "plain_text", text: "literal" },
      ]);
      yield* deploy(stack, options);
      expect(fixture.uploads).toHaveLength(1);
      vi.stubEnv("RENKIN_BINDING_TEST", "secret-second");
      yield* deploy(stack, options);
      expect(fixture.uploads).toHaveLength(2);
      fixture.settings.audience = "updated-audience";
      const updated = yield* deploy(stack, options);
      expect(updated.outputs.audience?.value).toBe("updated-audience");
      expect(fixture.uploads).toHaveLength(3);
      expect(fixture.uploads[2]?.bindings).toContainEqual({
        name: "AUTH",
        type: "secret_text",
        text: "secret-second",
      });
      expect(fixture.uploads[2]?.bindings).toContainEqual({
        name: "ACCESS_AUDIENCE",
        type: "plain_text",
        text: "updated-audience",
      });
      const persisted = yield* Effect.promise(() =>
        readFile(join(directory, "app/test.json"), "utf8"),
      );
      for (const value of [JSON.stringify(stack), JSON.stringify(progress), persisted]) {
        expect(value).not.toContain("secret-first");
        expect(value).not.toContain("secret-second");
      }
      fixture.settings.rejectUpload = true;
      vi.stubEnv("RENKIN_BINDING_TEST", "secret-provider-echo");
      const failure = yield* deploy(stack, options).pipe(Effect.flip);
      expect(failure.message).not.toContain("secret-provider-echo");
    }).pipe(Effect.scoped),
);

it.live(
  "uploads a secret resource output as secret_text even when a stale reference lacks its classification",
  () =>
    Effect.gen(function* () {
      const { fixture, prepared, options } = yield* setup();
      const token = {
        id: "token",
        type: "cloudflare.access-service-token",
        identity: "token",
        properties: {},
        secretOutputs: true,
      };
      const definition = {
        ...prepared,
        properties: {
          ...(prepared.properties as Record<string, Json>),
          bindings: {
            TOKEN: { ...resourceOutput(token, "clientSecret"), secret: false },
          },
        },
      };
      const resource = { definition, physicalId: "worker", outputs: {} };
      const service = options.services()["cloudflare.worker"];
      yield* service.bind?.(resource, {
        worker: resource,
        token: {
          definition: token,
          physicalId: "token",
          outputs: { clientSecret: "generated-secret" },
        },
      }) ?? Effect.void;
      expect(fixture.uploads[0]?.bindings).toEqual([
        { name: "TOKEN", type: "secret_text", text: "generated-secret" },
      ]);
    }).pipe(Effect.scoped),
);
