import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { defineStack, development } from "renkin";
import { d1, worker } from "renkin/cloudflare";

export const createD1Fixture = async () => {
  const root = await mkdtemp(fileURLToPath(new URL("../../fixtures/d1-", import.meta.url)));
  const migrations = join(root, "migrations");
  await mkdir(join(migrations, "meta"), { recursive: true });
  const sql =
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\nINSERT INTO users VALUES (1, 'Ada');";
  await writeFile(join(migrations, "0000_initial.sql"), sql);
  await writeFile(
    join(migrations, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{ idx: 0, version: "6", tag: "0000_initial", when: 1, breakpoints: true }],
    }),
  );
  const entry = join(root, "worker.ts");
  await writeFile(
    entry,
    `import {Effect} from "effect";import {d1} from "renkin/cloudflare";import {defineWorker} from "renkin/worker";
export default defineWorker({DB:d1("Database"),OTHER:d1("Other")},({DB,OTHER})=>({fetch:(request)=>Effect.gen(function*(){
 const path=new URL(request.url).pathname;
 if(path==="/write"){yield* DB.run("INSERT INTO users VALUES (?, ?)",[2,"Grace"]);return new Response("ok");}
 if(path==="/cross"){try{DB.native.batch([OTHER.native.prepare("SELECT 1")]);return new Response("accepted");}catch{return new Response("rejected");}}
 if(path==="/native")return Response.json(yield* Effect.promise(()=>DB.native.prepare("SELECT name FROM users ORDER BY id").raw({columnNames:true})));
 return Response.json((yield* DB.query("SELECT id, name FROM users ORDER BY id")).results);
})}));`,
  );
  const stack = defineStack({
    name: "d1-public",
    resources: [
      d1("Database", { migrations }),
      d1("Other"),
      worker("Api", { entry, compatibilityDate: "2026-07-30" }),
    ],
  });
  const run = <A>(
    action: (session: Effect.Success<ReturnType<typeof development>>) => Promise<A>,
    desired = stack,
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* development(desired, {
            directory: join(root, "state"),
            watch: false,
          });
          return yield* Effect.promise(() => action(session));
        }),
      ),
    );
  return {
    root,
    migrations,
    stack,
    entry,
    run,
    close: () => rm(root, { recursive: true, force: true }),
  };
};
