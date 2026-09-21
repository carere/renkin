import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, development } from "renkin";
import { kv, worker } from "renkin/cloudflare";

it.effect(
  "runs mutual named RPC, resolved KV clients and persistent native data across restart and rename",
  () =>
    Effect.promise(async () => {
      const root = await mkdtemp(join(process.cwd(), "tests/fixtures/connected-"));
      const directory = join(root, "state");
      const cache = kv("Cache");
      await writeFile(
        join(root, "a.ts"),
        `import {Effect} from "effect";import {defineWorker,workerReference} from "renkin/worker";import {kv} from "renkin/cloudflare";
  export default defineWorker({CACHE:kv("Cache"), B:workerReference("B",{entrypoint:"Service"})},({CACHE,B})=>({fetch:(request)=>Effect.gen(function*(){
    const path=new URL(request.url).pathname;
    if(path==="/echo")return new Response("from-a");
    if(path==="/write"){yield* CACHE.put("key","saved");return new Response("ok");}
    if(path==="/read")return new Response(yield* CACHE.get("key"));
    if(path==="/native")return new Response(yield* Effect.promise(()=>CACHE.native.get("key")));
    return new Response(yield* B.call(service=>service.message()));
  })}));`,
      );
      await writeFile(
        join(root, "b.ts"),
        `import {WorkerEntrypoint} from "cloudflare:workers";import {defineWorker,workerReference} from "renkin/worker";
  export class Service extends WorkerEntrypoint { async message(){return "b:"+await (await this.env.A.fetch("http://a/echo")).text();} }
  export default defineWorker({A:workerReference("A")},()=>({fetch:()=>new Response("b")}));`,
      );
      const stack = defineStack({
        name: "connected",
        resources: [
          cache,
          worker("A", { entry: join(root, "a.ts"), compatibilityDate: "2026-07-30" }),
          worker("B", { entry: join(root, "b.ts"), compatibilityDate: "2026-07-30" }),
        ],
      });
      const run = (
        test: (session: Effect.Success<ReturnType<typeof development>>) => Promise<void>,
        desired = stack,
      ) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const session = yield* development(desired, { directory, watch: false });
              yield* Effect.promise(() => test(session));
            }),
          ),
        );
      try {
        await run(async ({ workers }) => {
          if (!workers.A) throw new Error("Worker A missing");
          expect(await (await workers.A.fetch()).text()).toBe("b:from-a");
          expect(await (await workers.A.fetch("/write")).text()).toBe("ok");
          expect(await (await workers.A.fetch("/native")).text()).toBe("saved");
        });
        await run(async ({ workers }) => {
          if (!workers.A) throw new Error("Worker A missing");
          expect(await (await workers.A.fetch("/read")).text()).toBe("saved");
        });
        await writeFile(
          join(root, "a.ts"),
          (await readFile(join(root, "a.ts"), "utf8")).replace('kv("Cache")', 'kv("Renamed")'),
        );
        const renamed = defineStack({
          ...stack,
          renames: [{ from: "Cache", to: "Renamed" }],
          resources: [
            kv("Renamed"),
            ...stack.resources.filter((resource) => resource.id !== "Cache"),
          ],
        });
        await run(async ({ workers }) => {
          if (!workers.A) throw new Error("Worker A missing");
          expect(await (await workers.A.fetch("/read")).text()).toBe("saved");
        }, renamed);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }),
  30000,
);
