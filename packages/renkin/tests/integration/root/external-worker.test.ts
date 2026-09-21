import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, development } from "renkin";
import { worker } from "renkin/cloudflare";

it.effect(
  "runs a local external Worker implementation without adding it to owned Worker outputs",
  () =>
    Effect.promise(async () => {
      const root = await mkdtemp(join(process.cwd(), "tests/fixtures/external-"));
      const permanent = join(root, "permanent.mjs");
      const entry = join(root, "caller.mjs");
      await writeFile(permanent, 'export default {fetch(){return new Response("permanent")}}');
      await writeFile(
        entry,
        `import {defineWorker,externalWorker} from "renkin/worker";
      export default defineWorker({REVIEW:externalWorker("permanent-review",{localEntry:${JSON.stringify(permanent)}})},({REVIEW})=>({fetch:()=>REVIEW.call(service=>service.fetch("https://review/"))}));`,
      );
      const stack = defineStack({
        name: "external",
        resources: [worker("caller", { entry, compatibilityDate: "2026-07-30" })],
      });
      try {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const session = yield* development(stack, {
                directory: join(root, "state"),
                watch: false,
              });
              expect(Object.keys(session.workers)).toEqual(["caller"]);
              const caller = session.workers.caller;
              if (!caller) throw new Error("Missing caller");
              const response = yield* Effect.promise(() => caller.fetch());
              expect(yield* Effect.promise(() => response.text())).toBe("permanent");
            }),
          ),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }),
);
