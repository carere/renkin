import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineStack, output } from "@carere/renkin";
import { worker } from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import { FileStateRepository } from "@renkin/core/services/state/file-state-repository";
import { deploy } from "@renkin/core/use-cases/deploy";
import { Effect } from "effect";
import { stackDefinition } from "#src/contexts/root/services/deployment/stack-definition.ts";

const verifyDefinition = (definition: ReturnType<typeof stackDefinition>) => {
  expect(definition.resources[0]).not.toHaveProperty("options");
  expect(definition.resources[0]).not.toHaveProperty("website");
  expect(definition.resources[0]).toMatchObject({
    retain: false,
    protection: { allowDelete: true },
  });
};
const services = (calls: { apply: number; bind: number; remove: number }) => () => ({
  "cloudflare.worker": {
    deferredBindings: true,
    apply: () =>
      Effect.sync(() => {
        calls.apply++;
        return { published: true };
      }),
    bind: () =>
      Effect.sync(() => {
        calls.bind++;
      }),
    remove: () =>
      Effect.sync(() => {
        calls.remove++;
      }),
  },
});
it("keeps build recipes and hooks outside state across deploy, repeat and removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-framework-state-"));
  const entry = join(directory, "entry.mjs");
  await writeFile(entry, "export default {fetch(){return new Response('ready')}}");
  const calls = { build: 0, before: 0, after: 0, apply: 0, bind: 0, remove: 0 };
  const hooks = {
    beforeBuild: () => {
      calls.before++;
    },
    afterBuild: () => {
      calls.after++;
    },
  };
  const resource = {
    ...worker("Site", {
      compatibilityDate: "2026-07-30",
      allowDelete: true,
      retain: false,
      builder: {
        build: async () => {
          hooks.beforeBuild();
          calls.build++;
          hooks.afterBuild();
          return { entry };
        },
      },
    }),
    website: hooks,
  };
  const stack = defineStack({
    name: "framework-state",
    resources: [resource],
    outputs: { constant: output("kept") },
  });
  const state = new FileStateRepository(join(directory, "state"));
  const options = {
    environment: "local",
    yes: true,
    state,
    services: services(calls),
  };
  try {
    const prepared = await Effect.runPromise(prepareStack(stack));
    expect((prepared.resources[0] as typeof resource).options.builder?.build).toBeTypeOf(
      "function",
    );
    const definition = stackDefinition(prepared);
    verifyDefinition(definition);
    const first = await Effect.runPromise(deploy(definition, options));
    expect(() => structuredClone(first)).not.toThrow();
    expect(first.outputs.constant?.value).toBe("kept");
    const repeated = await Effect.runPromise(
      deploy(stackDefinition(await Effect.runPromise(prepareStack(stack))), options),
    );
    expect(repeated.resources.Site?.physicalId).toBe(first.resources.Site?.physicalId);
    await Effect.runPromise(deploy({ name: stack.name, resources: [] }, options));
    expect((await Effect.runPromise(state.read(stack.name, "local")))?.resources).toEqual({});
    expect(calls).toEqual({ build: 2, before: 2, after: 2, apply: 1, bind: 1, remove: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
