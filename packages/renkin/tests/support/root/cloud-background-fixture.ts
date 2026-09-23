import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, deploy, removeEnvironment } from "@carere/renkin";
import { kv, queue, worker, workflow } from "@carere/renkin/cloudflare";
import { Effect } from "effect";

const authorization = () => {
  const env = process.env;
  if (
    env.RENKIN_CLOUDFLARE_TEST_PREFIX !== "renkin-test" ||
    env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    env.RENKIN_CLOUDFLARE_EMAIL_ENABLED !== "true" ||
    !(Date.parse(env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "") > Date.now()) ||
    !(Number(env.RENKIN_CLOUDFLARE_EMAIL_MAX_MESSAGES) >= 1) ||
    !(Number(env.RENKIN_CLOUDFLARE_MAX_SPEND_USD) > 0) ||
    !env.RENKIN_CLOUDFLARE_EMAIL_FROM ||
    !env.RENKIN_CLOUDFLARE_EMAIL_TO
  )
    throw new Error(
      "Background cloud test requires current scoped email and resource authorization.",
    );
  return { from: env.RENKIN_CLOUDFLARE_EMAIL_FROM, to: env.RENKIN_CLOUDFLARE_EMAIL_TO };
};
const source = (from: string, to: string) => `import {EmailMessage} from "cloudflare:email";
import {Effect} from "effect";import {kv,queue,workflow,email} from "@carere/renkin/cloudflare";
import {defineWorker} from "@carere/renkin/worker";import {defineWorkflow} from "@carere/renkin/workflow";
const Store=kv("Store"),Jobs=queue("Jobs"),Flow=workflow("Flow",{worker:"App",className:"Job"});
const FROM=${JSON.stringify(from)},TO=${JSON.stringify(to)};
export const Job=defineWorkflow({Store,Mail:email({allowedDestinationAddresses:[TO],allowedSenderAddresses:[FROM]})},(event,steps,{Store,Mail})=>Effect.gen(function*(){
 const task=yield* steps.task("record",context=>Effect.gen(function*(){yield* Store.put("task-attempt",String(context.attempt));if(event.payload.retry&&context.attempt===1)return yield* Effect.fail(new Error("Expected first-attempt retry"));return {attempt:context.attempt,payload:event.payload};}),{retries:{limit:1,delay:"1 second",backoff:"constant"}});
 yield* steps.sleep("pause","1 second");
 yield* steps.task("email",()=>Effect.gen(function*(){
   yield* Store.put("email-attempts",String(Number((yield* Store.get("email-attempts"))??"0")+1));
   yield* Mail.send(new EmailMessage(FROM,TO,"From: "+FROM+"\\r\\nTo: "+TO+"\\r\\nMessage-ID: <"+event.instanceId+"@renkin.test>\\r\\nSubject: Renkin authorized background test\\r\\n\\r\\nYour authorized Renkin validation completed its queue and Workflow steps. Run: "+event.instanceId));
   yield* Store.put("email-accepted","yes");return {accepted:true};
 }),{retries:{limit:0,delay:"1 second"}});
 return task;
}));
export default defineWorker({Jobs,Flow,Store},({Jobs,Flow,Store})=>({
 scheduled:controller=>Jobs.send({id:"scheduled-"+controller.scheduledTime,cron:controller.cron}),
 queue:batch=>Effect.gen(function*(){for(const message of batch.messages){if(message.body.poison){yield* Store.put("queue-attempt",String(message.attempts));message.retry({delaySeconds:0});continue;}yield* Flow.create({id:message.body.id,params:message.body});message.ack();}}),
 fetch:async request=>{const path=new URL(request.url).pathname.slice(1);if(!path)return new Response("healthy");if(path==="send"){const body=await request.json();await Jobs.native.send(body);return new Response("queued");}if(path.startsWith("status/"))return Response.json(await (await Flow.native.get(path.slice(7))).status());return new Response(await Store.native.get(path));}
}));`;
const backgroundStack =
  (name: string, entry: string, deadEntry: string) =>
  (allowDelete = false, crons = ["0 0 1 1 *"]) => {
    const jobs = queue("Jobs", { allowDelete }),
      dead = queue("Dead", { allowDelete });
    return defineStack({
      name,
      resources: [
        kv("Store", { allowDelete }),
        jobs,
        dead,
        workflow("Flow", { worker: "App", className: "Job", allowDelete }),
        worker("App", {
          entry,
          compatibilityDate: "2026-07-30",
          allowDelete,
          crons,
          consumers: [
            {
              queue: jobs,
              maxBatchSize: 2,
              maxBatchTimeout: 0,
              maxRetries: 1,
              retryDelay: 0,
              deadLetterQueue: dead,
            },
          ],
        }),
        worker("DeadWorker", {
          entry: deadEntry,
          compatibilityDate: "2026-07-30",
          allowDelete,
          consumers: [{ queue: dead, maxBatchTimeout: 0 }],
        }),
      ],
    });
  };

export const createCloudBackgroundFixture = async () => {
  const { from, to } = authorization();
  const name = `renkin-test-jobs-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(
    fileURLToPath(new URL("../../fixtures/background-cloud-", import.meta.url)),
  );
  await writeFile(
    join(root, "ownership.json"),
    JSON.stringify({ name, environment: "background" }),
  );
  const entry = join(root, "worker.ts"),
    deadEntry = join(root, "dead.ts");
  await writeFile(entry, source(from, to));
  await writeFile(
    deadEntry,
    `import {defineWorker} from "@carere/renkin/worker";import {kv} from "@carere/renkin/cloudflare";export default defineWorker({Store:kv("Store")},({Store})=>({queue:async batch=>{for(const message of batch.messages)await Store.native.put("dead",JSON.stringify(message.body));}}));`,
  );
  const options = {
    environment: "background",
    yes: true,
    cloudflare: { stateScriptName: "renkin-test-state-v2" },
    progress: ({ id, kind }: { id: string; kind: string }) =>
      console.info(`Cloud background ${kind}: ${id}`),
  };
  const stack = backgroundStack(name, entry, deadEntry);
  console.info(
    `Cloud background ownership: ${name}/background; at most one live email attempt; backend retained.`,
  );
  return {
    name,
    root,
    options,
    stack,
    deploy: () => {
      authorization();
      return Effect.runPromise(deploy(stack(), options));
    },
    close: async () => {
      authorization();
      await Effect.runPromise(deploy(stack(true, []), options));
      await Effect.runPromise(removeEnvironment(name, options));
      await rm(root, { recursive: true, force: true });
      console.info(`Cloud background cleanup complete: ${name}/background`);
    },
  };
};
