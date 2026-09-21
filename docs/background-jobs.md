# Scheduled and durable background jobs

Renkin deploys cron schedules, native Queues consumers and Workflows alongside
Workers. Application code declares resource use once with `defineWorker` or
`defineWorkflow`; deployment derives the bindings. Effect clients expose `.native`
for the corresponding Cloudflare API.

## Declare the resources

```ts
// resources.ts — safe to import from application and deployment code
import { email, queue, workflow } from "renkin/cloudflare";

export interface Job { id: string; createdAt: number }
export const Jobs = queue<Job>("Jobs");
export const Dead = queue<Job>("Dead");
export const Completion = workflow<Job>("Completion", {
  worker: "App", className: "CompletionWorkflow",
});
export const Mail = email({
  allowedDestinationAddresses: ["verified-recipient@example.com"],
  allowedSenderAddresses: ["sender@example.com"],
});
```

```ts
// worker.ts
import { EmailMessage } from "cloudflare:email";
import { Effect } from "effect";
import { defineWorker, type QueueBatch } from "renkin/worker";
import { defineWorkflow, type WorkflowEvent } from "renkin/workflow";
import { Completion, Jobs, Mail, type Job } from "./resources.ts";

export const CompletionWorkflow = defineWorkflow(
  { Mail },
  (event: WorkflowEvent<Job>, steps, { Mail }) => Effect.gen(function* () {
    const result = yield* steps.task("process", ({ attempt }) =>
      Effect.succeed({ job: event.payload.id, attempt }),
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
    );
    yield* steps.sleep("cooldown", "1 second");
    yield* steps.task("notify", () => Mail.send(new EmailMessage(
      "sender@example.com", "verified-recipient@example.com",
      "From: sender@example.com\r\nTo: verified-recipient@example.com\r\n" +
      `Message-ID: <${event.instanceId}@example.com>\r\n` +
      "Subject: Job complete\r\n\r\n" + result.job,
    )), { retries: { limit: 0, delay: "1 second" } });
    return result;
  },
);
export default defineWorker({ Jobs, Completion }, ({ Jobs, Completion }) => ({
  scheduled: (controller) => Jobs.send({
    id: `job-${controller.scheduledTime}`, createdAt: controller.scheduledTime,
  }),
  queue: (batch: QueueBatch<Job>) => Effect.gen(function* () {
    for (const message of batch.messages) {
      yield* Completion.create({ id: message.body.id, params: message.body });
      message.ack();
    }
  }),
}));
```

Cloudflare supplies `cloudflare:email`, `cloudflare:workers` and
`cloudflare:workflows` inside Workers. Use your generated Cloudflare environment
types when authoring application modules. `renkin/workflow` is a Worker-only
entrypoint; infrastructure code imports `workflow` from `renkin/cloudflare`.
Workflow class exports and their inert requirements are inspected without running
handler factories. An optional third argument to either definition supplies the
Effect service layer needed by the handlers or Workflow tasks.

```ts
// renkin.ts
import { defineStack } from "renkin";
import { worker } from "renkin/cloudflare";
import { Completion, Dead, Jobs } from "./resources.ts";

export default defineStack({
  name: "jobs",
  resources: [Jobs, Dead, Completion, worker("App", {
    entry: "./worker.ts", compatibilityDate: "2026-07-30",
    crons: ["*/5 * * * *"],
    consumers: [{ queue: Jobs, maxBatchSize: 10, maxBatchTimeout: 5,
      maxRetries: 3, retryDelay: 5, deadLetterQueue: Dead }],
  }), worker("DeadWorker", {
    entry: "./dead-worker.ts", compatibilityDate: "2026-07-30",
    consumers: [{ queue: Dead, maxBatchSize: 10, maxBatchTimeout: 1 }],
  })],
});
```

The dead-letter Worker implements a normal queue handler, for example writing the
message to durable storage for inspection before acknowledging it. Queue routing
and retry settings are deployment configuration; they do not repeat application
binding declarations. `maxBatchTimeout` is in seconds. `maxConcurrency: null`
selects Cloudflare automatic consumer concurrency. Queue `deliveryDelay` and
optional `messageRetentionPeriod` are seconds; omitted retention uses the provider
plan's default. One declared consumer owns each queue; it cannot be its own DLQ.

A successful native batch automatically acknowledges messages that were not
explicitly retried. Use `message.ack()`, `message.retry({ delaySeconds })`,
`batch.ackAll()` and `batch.retryAll()` directly; Renkin preserves native semantics.
Queue delivery is at least once, so use stable Workflow IDs and handle duplicate
business events according to your application's policy. Acknowledging follows
successful processing; do not acknowledge work before it has been accepted.
[Cloudflare queue retry semantics](https://developers.cloudflare.com/queues/configuration/batching-retries/).

Workflow `steps.task` runs an Effect inside a native durable step. Its callback
receives native attempt context. `steps.sleep`, `steps.sleepUntil` and
`steps.waitForEvent` preserve native behavior; `steps.native` exposes the complete
native step API. Return serializable step results. Native `NonRetryableError` from
`cloudflare:workflows` remains fatal through the Effect boundary. Side effects
outside durable steps may run again; even a step can retry after a partial side
effect. Give external operations idempotency keys where appropriate. Email step
retry limits do not constitute an exactly-once delivery guarantee.

## Local development and tests

`development(stack, { directory })` starts the application graph without provider
credentials. Cron expressions are deployed to Cloudflare; local tests explicitly
invoke scheduled events rather than waiting for a local timer.

```ts
import { Effect } from "effect";
import { development } from "renkin";
import { applicationFixture, capturedEmails, scheduled } from "renkin/testing";
import stack from "./renkin.ts";

const test = Effect.scoped(Effect.gen(function* () {
  const app = yield* applicationFixture(() => development(stack, {
    directory: ".renkin-test", watch: false,
  }));
  const worker = app.current.workers.App;
  if (!worker) throw new Error("Missing App Worker");
  yield* scheduled(worker, {
    cron: "*/5 * * * *", scheduledTime: new Date("2026-07-30T12:00:00Z"),
  });
  // Await an observable completion condition through your application API.
  const messages = yield* capturedEmails(app.current);
  yield* app.restart; // closes and reopens against the same persistence directory
  return messages;
}));
```

`scheduled` dispatches the real workerd event with its controller and execution
context. `capturedEmails` returns complete native `.eml` messages. Local email
never sends externally; read captures before closing or restarting the session.
The public fixture keeps the caller's persistence directory and releases the
old local runtime before opening the new one.

**Local queue backlog is not durable across runtime recreation.** The selected
Miniflare queue broker is in memory. Batching, acknowledgement, retries and DLQ
routing run natively, but queued or delayed messages can be lost on restart or
reload. Consumer concurrency, provider retention, account limits and real cron
delivery require cloud validation. Do not infer cloud queue durability from a
local restart test.

**Workflow progress is persistent.** Renkin journals local instance creation IDs
and uses native pause/resume to wake the installed emulator after recreation or
reload. This retains its original event, completed step results, retry attempt,
sleep deadline and pending event. User-paused instances stay paused. A persisted
recovery intent lets the next startup finish an interrupted wake. No synthetic
Workflow engine or replacement instance is used. An instance observed as
`queued` or `unknown` during recovery fails startup with an explicit diagnostic
rather than recreating it with a changed event. Cloud bindings bypass this local
journal and use Cloudflare's own engine directly.

## Protection and lifecycle

Queues, DLQs, Workflows and their owning Workers are protected by default even
when empty. Whole-plan validation rejects deletion or replacement before any
resource changes. `yes` only accepts confirmation and `force` only reruns work;
neither permits data loss. Explicit logical-ID renames preserve provider identity.
Changing a Workflow class name changes its identity and requires replacement
permission.

For disposable environments, set `allowDelete: true` on every data resource and
owning Worker when declaring them. To change an existing environment's policy,
first deploy the explicit settings, then remove the environment. Consumer removal
and replacement verify recorded queue and Worker ownership before changing the
provider consumer. Worker deletion refuses while a native Workflow remains,
including a retained empty Workflow. Queue deletion refuses remaining producers
or consumers; no provider force-delete bypass is used.

## Validation evidence

Credential-free public tests cover scheduled → queue → Workflow → captured email,
native batch retries and DLQ delivery, Workflow retry attempts, cached steps and
original timestamps across recreation, pending events, user pause, interrupted
wake recovery, native fatal errors, and empty-resource protection. SDK HTTP tests
verify actual Distilled serialization, pagination, nullable consumer concurrency,
cron settings, ownership checks, replacement and interrupted consumer cleanup.

Run the separate temporary-cloud suite only with explicit current resource and
email authorization:

```sh
bun --env-file=/secure/path/cloud.env node_modules/vitest/vitest.mjs run \
  --config vitest.cloud.config.ts tests/cloud/root/background.test.ts
# Run from packages/renkin. Normal test projects exclude tests/cloud.
```

The 2026-09-21 cloud run `renkin-test-jobs-7a4fe3b7/background` passed native queue
production, Workflow retry to attempt 2, one authorized email send accepted by
Cloudflare, poison-message retry and DLQ delivery, protection and explicit cleanup.
All six temporary resources were removed through Renkin; the shared state backend
was retained. One live email attempt was made. The user subsequently confirmed
receiving the test email, providing inbox-delivery evidence as well as provider
acceptance. The test deploys an inactive annual cron schedule and invokes
its producer explicitly; the full scheduled-event chain is exercised locally.
An earlier run failed its health check before producing any jobs, sent zero emails,
and also cleaned up completely.
