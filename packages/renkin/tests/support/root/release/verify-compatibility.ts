import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute, type InstalledConsumer } from "./consumer.ts";

/** Exercise public development from the tarball, including the original consumer date. */
export const verifyCompatibility = async (consumer: InstalledConsumer) => {
  await writeFile(
    join(consumer.directory, "compatibility-worker.ts"),
    'export default {fetch(_request, env) {return Response.json({bound: env.TOKEN === "synthetic-secret"})}};',
  );
  const source = `import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {defineStack, development, secret} from "@carere/renkin";
import {worker} from "@carere/renkin/cloudflare";
import {Effect} from "effect";
const fromRenkin = createRequire(import.meta.resolve("@carere/renkin"));
const backend = createRequire(fromRenkin.resolve("miniflare"));
const frontend = createRequire(fromRenkin.resolve("@cloudflare/vite-plugin/package.json"));
const versions = {
  miniflare: backend("miniflare/package.json").version,
  backendWorkerd: backend("workerd").version,
  viteWorkerd: frontend("workerd").version,
};
assert.equal(versions.backendWorkerd, versions.viteWorkerd);
assert.equal(process.env.MINIFLARE_WORKERD_PATH, undefined);
process.env.COMPATIBILITY_TOKEN = "synthetic-secret";
const stack = (date) => defineStack({name: "compatibility", resources: [worker("Api", {
  entry: new URL("./compatibility-worker.ts", import.meta.url).pathname,
  compatibilityDate: date,
  bindings: {TOKEN: secret("COMPATIBILITY_TOKEN")},
})]});
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const session = yield* development(stack("2026-09-08"), {directory: "compatibility-state", watch: false});
  const body = yield* Effect.promise(async () => (await session.workers.Api.fetch("/")).json());
  assert.deepEqual(body, {bound: true});
})));
const failure = await Effect.runPromise(Effect.scoped(development(stack("2999-01-01"), {
  directory: "compatibility-state", watch: false,
})).pipe(Effect.match({onFailure: error => error, onSuccess: () => undefined})));
assert.match(failure?.message ?? "", /2999-01-01/);
assert.match(failure.message, /future/);
assert.ok(!String(failure).includes("synthetic-secret"));
console.log(JSON.stringify({date: "2026-09-08", ...versions, negativeDate: "passed"}));`;
  const path = join(consumer.directory, "verify-compatibility.ts");
  await writeFile(path, source);
  const result = await execute(process.execPath, ["--no-env-file", path], {
    cwd: consumer.directory,
    env: consumer.env,
    timeout: 30000,
    maxBuffer: 20000,
  });
  assert.doesNotMatch(result.stderr, /synthetic-secret/);
  return result.stdout;
};
