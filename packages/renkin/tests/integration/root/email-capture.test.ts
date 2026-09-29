import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineStack, development } from "@carere/renkin";
import { worker } from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

const workerSource = `
import { EmailMessage } from "cloudflare:email";
import { Effect } from "effect";
import { email } from "@carere/renkin/cloudflare";
import { defineWorker } from "@carere/renkin/worker";
export default defineWorker({Mail:email({allowedDestinationAddresses:["to@example.com"]})}, ({Mail}) => ({
 fetch: request => Effect.gen(function* () {
   const mode = new URL(request.url).pathname;
   if(mode === "/raw") yield* Mail.send(new EmailMessage("from@example.com", "to@example.com",
     "From: from@example.com\\r\\nTo: to@example.com\\r\\nMessage-ID: <same@example.com>\\r\\nSubject: Raw\\r\\n\\r\\nraw body"));
   else yield* Mail.send({from:{email:"from@example.com",name:"Sender"},to:mode === "/reject" ? "blocked@example.com" : "to@example.com",subject:"Structured",text:"text body",html:"<p>html body</p>"});
   return new Response("ok");
 })
}));
`;

it.live(
  "captures each successful structured and raw send once and isolates sessions",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(process.cwd(), ".email-capture-"))),
        (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
      );
      const entry = join(root, "worker.ts");
      yield* Effect.promise(() => writeFile(entry, workerSource));
      const stack = defineStack({
        name: "email-capture",
        resources: [worker("MailWorker", { entry, compatibilityDate: "2026-09-08", port: 0 })],
      });
      const run = (
        action: (session: Effect.Success<ReturnType<typeof development>>) => Promise<void>,
      ) =>
        development(stack, { directory: join(root, "state"), watch: false }).pipe(
          Effect.flatMap((session) => Effect.promise(() => action(session))),
          Effect.scoped,
        );
      yield* run(async (session) => {
        const app = session.workers.MailWorker;
        if (!app) throw new Error("Missing Worker");
        expect(await session.capturedEmails()).toEqual([]);
        for (const path of ["/structured", "/structured", "/raw", "/raw"])
          expect((await app.fetch(path)).status).toBe(200);
        const captured = await session.capturedEmails();
        expect(captured).toHaveLength(4);
        const structured = captured.filter((message) => message.includes("Subject: Structured"));
        expect(structured).toHaveLength(2);
        for (const message of structured) {
          expect(message).toContain("Sender");
          expect(message).toContain("to@example.com");
          expect(message).toContain("text body");
          expect(message).toContain("<p>html body</p>");
        }
        expect(captured.filter((message) => message.includes("Subject: Raw"))).toHaveLength(2);
        await Effect.runPromise(
          development(stack, { directory: join(root, "isolated"), watch: false }).pipe(
            Effect.flatMap((isolated) =>
              Effect.promise(async () => {
                expect(await isolated.capturedEmails()).toEqual([]);
                const other = isolated.workers.MailWorker;
                if (!other) throw new Error("Missing isolated Worker");
                expect((await other.fetch("/structured")).status).toBe(200);
                expect(await isolated.capturedEmails()).toHaveLength(1);
                expect(await session.capturedEmails()).toEqual(captured);
              }),
            ),
            Effect.scoped,
          ),
        );
        expect((await app.fetch("/reject")).status).toBe(500);
        expect(await session.capturedEmails()).toEqual(captured);
        for (let index = 0; index < 101; index++)
          expect((await app.fetch("/structured")).status).toBe(200);
        expect(await session.capturedEmails()).toHaveLength(105);
        const beforeReload = await session.capturedEmails();
        await app.reload();
        expect(await session.capturedEmails()).toEqual(beforeReload);
      });
      yield* run(async (session) => expect(await session.capturedEmails()).toEqual([]));
    }).pipe(Effect.scoped),
  30000,
);
