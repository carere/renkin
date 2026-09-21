import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { inspectRequirements } from "../../../../src/contexts/root/services/bundler/inspect-requirements.ts";

it.effect("reads only inert requirements without invoking handlers or factories", () =>
  Effect.promise(async () => {
    const source =
      'export default {__renkinRequirements:{CACHE:{type:"cloudflare.kv",id:"cache"}},fetch(){throw new Error("must not run")}}';
    expect(await inspectRequirements(source, "2026-07-30")).toEqual({
      CACHE: { type: "cloudflare.kv", id: "cache" },
    });
  }),
);
it.effect("cannot perform module-initialization network requests", () =>
  Effect.promise(async () => {
    await expect(
      inspectRequirements(
        'await fetch("https://example.invalid/credentials");export default {fetch(){return new Response("bad")}}',
        "2026-07-30",
      ),
    ).rejects.toThrow("isolated runtime");
  }),
);
it.effect("rejects invalid metadata instead of silently omitting its binding", () =>
  Effect.promise(async () => {
    await expect(
      inspectRequirements(
        'export default {__renkinRequirements:{bad:{type:"unsupported",id:"cache"}}}',
        "2026-07-30",
      ),
    ).rejects.toThrow("isolated runtime");
  }),
);
it.effect(
  "validates named native Workflow exports and merges inert requirements without instantiating classes",
  () =>
    Effect.promise(async () => {
      const source = `import {WorkflowEntrypoint} from "cloudflare:workers";
  export class Job extends WorkflowEntrypoint {static __renkinRequirements={JOBS:{type:"cloudflare.queue",id:"Jobs"}};constructor(){super();throw new Error("must not construct")}run(){throw new Error("must not run")}}
  export default {__renkinRequirements:{FLOW:{type:"cloudflare.workflow",id:"Flow"}}};`;
      expect(
        await inspectRequirements(source, "2026-07-30", undefined, undefined, ["Job"]),
      ).toEqual({
        JOBS: { type: "cloudflare.queue", id: "Jobs" },
        FLOW: { type: "cloudflare.workflow", id: "Flow" },
      });
      await expect(
        inspectRequirements(source, "2026-07-30", undefined, undefined, ["Missing"]),
      ).rejects.toThrow("isolated runtime");
    }),
);
