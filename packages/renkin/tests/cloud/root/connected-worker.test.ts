import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { defineStack, deploy, readOutputs, removeEnvironment } from "renkin";
import { kv, worker } from "renkin/cloudflare";

const http = async (url: string, expected: string) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(url).catch(() => undefined);
    if (response?.ok && (await response.text()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Connected Worker response did not propagate before the deadline.");
};
const scope = () => {
  const prefix = process.env.RENKIN_CLOUDFLARE_TEST_PREFIX;
  if (
    !prefix ||
    process.env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    process.env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    !(Date.parse(process.env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "") > Date.now())
  )
    throw new Error("Connected cloud checks require current authorization.");
  return { prefix, stateScriptName: `${prefix}-state-v2` };
};
type Scenario = Awaited<ReturnType<typeof setup>>;
const setup = async () => {
  const { prefix, stateScriptName } = scope();
  const root = await mkdtemp(join(process.cwd(), "tests/fixtures/cloud-connected-"));
  const name = `${prefix}-${randomUUID().slice(0, 8)}`;
  const permanentName = `${name}-permanent`;
  const options = { environment: "graph", yes: true, cloudflare: { stateScriptName } };
  const permanentEntry = join(root, "permanent.mjs");
  await writeFile(permanentEntry, 'export default {fetch(){return new Response("permanent")}}');
  const permanent = defineStack({
    name: permanentName,
    resources: [worker("review", { entry: permanentEntry, compatibilityDate: "2026-09-21" })],
  });
  const desired = defineStack({
    name,
    resources: [
      kv("Cache"),
      worker("A", { entry: join(root, "a.mjs"), compatibilityDate: "2026-09-21" }),
      worker("B", { entry: join(root, "b.mjs"), compatibilityDate: "2026-09-21" }),
    ],
  });
  console.info(
    `Cloud graph ownership: ${name}/graph and ${permanentName}/graph; retained backend ${stateScriptName}`,
  );
  return {
    root,
    name,
    permanentName,
    options,
    permanentEntry,
    permanent,
    desired,
    applicationStarted: false,
    cleaned: false,
  };
};
const writeApplication = async (root: string, externalName: string) => {
  await writeFile(
    join(root, "a.mjs"),
    `import {Effect} from "effect";import {defineWorker,workerReference,externalWorker} from "renkin/worker";import {kv} from "renkin/cloudflare";
      export default defineWorker({CACHE:kv("Cache"),B:workerReference("B",{entrypoint:"Service"}),REVIEW:externalWorker(${JSON.stringify(externalName)})},({CACHE,B,REVIEW})=>({fetch:(request)=>Effect.gen(function*(){
        const path=new URL(request.url).pathname;
        if(path==="/echo")return new Response("from-a");
        if(path==="/write"){yield* CACHE.put("key","saved");return new Response("ok");}
        if(path==="/read")return new Response(yield* CACHE.get("key"));
        if(path==="/native")return new Response(yield* Effect.promise(()=>CACHE.native.get("key")));
        const message=yield* B.call(service=>service.message());const review=yield* REVIEW.call(service=>service.fetch("https://review/"));
        return new Response(message+":"+(yield* Effect.promise(()=>review.text())));
      })}));`,
  );
  await writeFile(
    join(root, "b.mjs"),
    'import {WorkerEntrypoint} from "cloudflare:workers";import {defineWorker,workerReference} from "renkin/worker";export class Service extends WorkerEntrypoint {async message(){return "b:"+await (await this.env.A.fetch("https://a/echo")).text();}} export default defineWorker({A:workerReference("A")},()=>({fetch:()=>new Response("b")}));',
  );
};
const read = (name: string, scenario: Scenario) =>
  Effect.runPromise(readOutputs(name, "graph", { cloudflare: scenario.options.cloudflare }));
const permitDeletion = (scenario: Scenario) =>
  defineStack({
    ...scenario.desired,
    resources: scenario.desired.resources.map((resource) =>
      resource.type === "cloudflare.kv" ? kv(resource.id, { allowDelete: true }) : resource,
    ),
  });
const checkProtection = async (scenario: Scenario) => {
  const before = await read(scenario.name, scenario);
  const proposed = defineStack({
    name: scenario.name,
    resources: [
      worker("Unexpected", { entry: scenario.permanentEntry, compatibilityDate: "2026-09-21" }),
    ],
  });
  await expect(
    Effect.runPromise(deploy(proposed, { ...scenario.options, force: true })),
  ).rejects.toThrow("Deletion protection");
  expect(await read(scenario.name, scenario)).toEqual(before);
};
const checkRename = async (scenario: Scenario, id: string | undefined, url: string) => {
  const entry = join(scenario.root, "a.mjs");
  await writeFile(entry, (await readFile(entry, "utf8")).replace('kv("Cache")', 'kv("Renamed")'));
  scenario.desired = defineStack({
    ...scenario.desired,
    renames: [{ from: "Cache", to: "Renamed" }],
    resources: [
      kv("Renamed"),
      ...scenario.desired.resources.filter((resource) => resource.id !== "Cache"),
    ],
  });
  const renamed = await Effect.runPromise(deploy(scenario.desired, scenario.options));
  expect(renamed.resources.Renamed?.physicalId).toBe(id);
  await http(`${url}/read`, "saved");
  await http(url, "b:from-a:permanent");
};
const run = async (scenario: Scenario) => {
  const owner = await Effect.runPromise(deploy(scenario.permanent, scenario.options));
  const externalName = owner.resources.review?.physicalId;
  if (!externalName) throw new Error("Permanent Worker ID missing.");
  const permanentOutput = owner.resources.review?.outputs as { url: string };
  await writeApplication(scenario.root, externalName);
  scenario.applicationStarted = true;
  const first = await Effect.runPromise(deploy(scenario.desired, scenario.options));
  const output = first.resources.A?.outputs as { url: string };
  expect(Object.keys(first.resources).sort()).toEqual(["A", "B", "Cache"]);
  await http(output.url, "b:from-a:permanent");
  await http(`${output.url}/write`, "ok");
  await http(`${output.url}/native`, "saved");
  await checkProtection(scenario);
  await checkRename(scenario, first.resources.Cache?.physicalId, output.url);
  await Effect.runPromise(deploy(permitDeletion(scenario), scenario.options));
  await Effect.runPromise(removeEnvironment(scenario.name, scenario.options));
  scenario.cleaned = true;
  await http(permanentOutput.url, "permanent");
  expect((await read(scenario.permanentName, scenario))?.review).toBeDefined();
};
const cleanup = async (scenario: Scenario) => {
  try {
    if (scenario.applicationStarted && !scenario.cleaned) {
      await Effect.runPromise(deploy(permitDeletion(scenario), scenario.options));
      await Effect.runPromise(removeEnvironment(scenario.name, scenario.options));
    }
    await Effect.runPromise(removeEnvironment(scenario.permanentName, scenario.options));
  } catch {
    throw new Error(
      `Cleanup needs attention for exact owned environments ${scenario.name}/graph and ${scenario.permanentName}/graph.`,
    );
  } finally {
    await rm(scenario.root, { recursive: true, force: true });
  }
};
it.effect(
  "preserves connected KV and renamed identity, blocks mixed deletion, and leaves external Worker ownership intact",
  () =>
    Effect.promise(async () => {
      const scenario = await setup();
      const errors: unknown[] = [];
      try {
        await run(scenario);
      } catch (error) {
        errors.push(error);
      }
      try {
        await cleanup(scenario);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "Cloud graph check failed; inspect the owned environments reported above.",
        );
    }),
  300000,
);
