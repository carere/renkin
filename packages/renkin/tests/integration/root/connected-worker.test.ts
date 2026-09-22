import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, development } from "renkin";
import { kv, worker } from "renkin/cloudflare";

const run = (
  directory: string,
  test: (session: Effect.Success<ReturnType<typeof development>>) => Promise<void>,
  desired: ReturnType<typeof defineStack>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* development(desired, { directory, watch: false });
        yield* Effect.promise(() => test(session));
      }),
    ),
  );
const writeApplication = async (root: string) => {
  await writeFile(
    join(root, "resources.mjs"),
    'import {kv} from "renkin/cloudflare"; export const Cache=kv("Cache");',
  );
  await writeFile(
    join(root, "a.mjs"),
    `import {Effect} from "effect";import {defineWorker,workerReference} from "renkin/worker";import {Cache} from "./resources.mjs";
  export default defineWorker({CACHE:Cache, B:workerReference("B",{entrypoint:"Service"})},({CACHE,B})=>({fetch:(request)=>Effect.gen(function*(){
    const path=new URL(request.url).pathname;
    if(path==="/echo")return new Response("from-a");
    if(path==="/write"){yield* CACHE.put("key","saved");return new Response("ok");}
    if(path==="/read")return new Response(yield* CACHE.get("key"));
    if(path==="/json"){yield* CACHE.put("json",JSON.stringify({count:1}),{metadata:{source:"worker"}});return Response.json(yield* CACHE.getJson("json"));}
    if(path==="/list")return new Response((yield* CACHE.list({prefix:"json"})).keys.map(key=>key.name).join(","));
    if(path==="/delete"){yield* CACHE.delete("json");return new Response(String(yield* CACHE.get("json")));}
    if(path==="/native")return new Response(yield* Effect.promise(()=>CACHE.native.get("key")));
    return new Response(yield* B.call(service=>service.message()));
  })}));`,
  );
  await writeFile(
    join(root, "b.mjs"),
    `import {WorkerEntrypoint} from "cloudflare:workers";import {defineWorker,workerReference} from "renkin/worker";
  export class Service extends WorkerEntrypoint { async message(){return "b:"+await (await this.env.A.fetch("http://a/echo")).text();} }
  export default defineWorker({A:workerReference("A")},()=>({fetch:()=>new Response("b")}));`,
  );
};
const sharedCache = async (root: string): Promise<ReturnType<typeof kv>> =>
  (await import(pathToFileURL(join(root, "resources.mjs")).href)).Cache;

it.effect(
  "runs mutual named RPC, resolved KV clients and persistent native data across restart and rename",
  () =>
    Effect.promise(async () => {
      const root = await mkdtemp(join(process.cwd(), "tests/fixtures/connected-"));
      const directory = join(root, "state");
      await writeApplication(root);
      const stack = defineStack({
        name: "connected",
        resources: [
          await sharedCache(root),
          worker("A", { entry: join(root, "a.mjs"), compatibilityDate: "2026-07-30" }),
          worker("B", { entry: join(root, "b.mjs"), compatibilityDate: "2026-07-30" }),
        ],
      });
      try {
        await run(
          directory,
          async ({ workers }) => {
            if (!workers.A) throw new Error("Worker A missing");
            expect(await (await workers.A.fetch()).text()).toBe("b:from-a");
            expect(await (await workers.A.fetch("/write")).text()).toBe("ok");
            expect(await (await workers.A.fetch("/native")).text()).toBe("saved");
            expect(await (await workers.A.fetch("/json")).json()).toEqual({ count: 1 });
            expect(await (await workers.A.fetch("/list")).text()).toBe("json");
            expect(await (await workers.A.fetch("/delete")).text()).toBe("null");
            await writeFile(
              join(root, "a.mjs"),
              (await readFile(join(root, "a.mjs"), "utf8")).replace("from-a", "hot-a"),
            );
            await workers.A.reload();
            expect(await (await workers.A.fetch()).text()).toBe("b:hot-a");
            expect(await (await workers.A.fetch("/native")).text()).toBe("saved");
          },
          stack,
        );
        await run(
          directory,
          async ({ workers }) => {
            if (!workers.A) throw new Error("Worker A missing");
            expect(await (await workers.A.fetch("/read")).text()).toBe("saved");
          },
          stack,
        );
        await writeFile(
          join(root, "resources.mjs"),
          (await readFile(join(root, "resources.mjs"), "utf8")).replace(
            'kv("Cache")',
            'kv("Renamed")',
          ),
        );
        const renamed = defineStack({
          ...stack,
          renames: [{ from: "Cache", to: "Renamed" }],
          resources: [
            kv("Renamed"),
            ...stack.resources.filter((resource) => resource.id !== "Cache"),
          ],
        });
        await run(
          directory,
          async ({ workers }) => {
            if (!workers.A) throw new Error("Worker A missing");
            expect(await (await workers.A.fetch("/read")).text()).toBe("saved");
          },
          renamed,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }),
  30000,
);
