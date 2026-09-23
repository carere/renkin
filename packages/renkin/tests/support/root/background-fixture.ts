import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, development } from "@carere/renkin";
import { kv, queue, worker, workflow } from "@carere/renkin/cloudflare";
import { Effect } from "effect";

const source = `import {NonRetryableError} from "cloudflare:workflows";
import {EmailMessage} from "cloudflare:email";
import {Effect} from "effect";import {kv,queue,workflow,email} from "@carere/renkin/cloudflare";
import {defineWorker} from "@carere/renkin/worker";import {defineWorkflow} from "@carere/renkin/workflow";
const Store=kv("Store"),Jobs=queue("Jobs"),Flow=workflow("Flow",{worker:"App",className:"Job"});
export const Job=defineWorkflow({Store,Mail:email({allowedDestinationAddresses:["recipient@example.com"],allowedSenderAddresses:["sender@example.com"]})},(event,steps,{Store,Mail})=>Effect.gen(function*(){
 const task=yield* steps.task("record",context=>Effect.gen(function*(){
   const count=Number((yield* Store.get(event.instanceId))??"0")+1;
   yield* Store.put(event.instanceId,String(count));
   yield* Store.put(event.instanceId+"-timestamp",event.timestamp.toISOString());
   return {attempt:context.attempt,payload:event.payload,timestamp:event.timestamp.toISOString()};
 }),{retries:{limit:0,delay:"1 second"}});
 if(event.payload.retry)yield* steps.task("retry",context=>Effect.gen(function*(){
   yield* Store.put(event.instanceId+"-attempt",String(context.attempt));
   if(context.attempt===1) return yield* Effect.fail(new Error("retry me"));
   return context.attempt;
 }),{retries:{limit:2,delay:"2 seconds",backoff:"constant"}});
 if(event.payload.fatal)yield* steps.task("fatal",context=>Effect.gen(function*(){
   yield* Store.put(event.instanceId+"-attempt",String(context.attempt));
   return yield* Effect.fail(new NonRetryableError("Expected fatal failure"));
 }),{retries:{limit:2,delay:"1 second"}});
 if(event.payload.wait)yield* steps.waitForEvent("event",{type:"approval",timeout:"30 seconds"});
 if(event.payload.until)yield* steps.sleepUntil("deadline",event.payload.until);
 else yield* steps.sleep("pause",event.payload.sleep??"1 second");
 yield* steps.task("email",()=>Mail.send(new EmailMessage("sender@example.com","recipient@example.com","From: sender@example.com\\r\\nTo: recipient@example.com\\r\\nMessage-ID: <job@example.com>\\r\\nSubject: Job "+event.instanceId+"\\r\\n\\r\\nCompleted")),{retries:{limit:0,delay:"1 second"}});
 return task;
}));
export default defineWorker({Jobs,Flow,Store},({Jobs,Flow,Store})=>({
 scheduled:(controller,_env,context)=>{context.waitUntil(Store.native.put("scheduled-context","ready"));return Jobs.send({id:"scheduled-"+controller.scheduledTime,cron:controller.cron});},
 queue:batch=>Effect.gen(function*(){for(const message of batch.messages){if(message.body.mode){yield* Store.put(message.body.mode+"-attempts",String(message.attempts));yield* Store.put("batch-size",String(batch.messages.length));if(message.body.mode==="poison")message.retry({delaySeconds:0});else message.ack();continue;}yield* Flow.create({id:message.body.id,params:message.body});message.ack();}}),
 fetch:async request=>{const path=new URL(request.url).pathname.slice(1);if(!path)return new Response("healthy");if(path==="batch"){await Jobs.native.sendBatch([{body:{mode:"ack"}},{body:{mode:"poison"}}]);return new Response("sent");}if(path.startsWith("event/")){await (await Flow.native.get(path.slice(6))).sendEvent({type:"approval",payload:{approved:true}});return new Response("delivered");}if(path.startsWith("create/")){const instance=await Flow.native.create({id:path.slice(7),params:await request.json()});return Response.json({id:instance.id});}if(path.startsWith("pause/")){await (await Flow.native.get(path.slice(6))).pause();return new Response("paused");}if(path.startsWith("resume/")){await (await Flow.native.get(path.slice(7))).resume();return new Response("resumed");}if(path.startsWith("status/")){const instance=await Flow.native.get(path.slice(7));return Response.json(await instance.status());}return new Response(await Store.native.get(path));}
}));`;
export const createBackgroundFixture = async () => {
  const root = await mkdtemp(fileURLToPath(new URL("../../fixtures/background-", import.meta.url)));
  const entry = join(root, "worker.ts");
  await writeFile(entry, source);
  const jobs = queue("Jobs"),
    dead = queue("Dead");
  const deadEntry = join(root, "dead.ts");
  await writeFile(
    deadEntry,
    `import {Effect} from "effect";import {defineWorker} from "@carere/renkin/worker";import {kv} from "@carere/renkin/cloudflare";export default defineWorker({Store:kv("Store")},({Store})=>({queue:batch=>Effect.gen(function*(){for(const message of batch.messages)yield* Store.put("dead",JSON.stringify(message.body));})}));`,
  );
  const stack = defineStack({
    name: "background-public",
    resources: [
      kv("Store"),
      jobs,
      dead,
      worker("DeadWorker", {
        entry: deadEntry,
        compatibilityDate: "2026-07-30",
        consumers: [{ queue: dead, maxBatchTimeout: 0 }],
      }),
      workflow("Flow", { worker: "App", className: "Job" }),
      worker("App", {
        entry,
        compatibilityDate: "2026-07-30",
        crons: ["* * * * *"],
        consumers: [
          {
            queue: jobs,
            maxBatchTimeout: 0,
            maxBatchSize: 2,
            maxRetries: 1,
            deadLetterQueue: dead,
          },
        ],
      }),
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
  return { root, entry, stack, run, close: () => rm(root, { recursive: true, force: true }) };
};
