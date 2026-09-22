import { EmailMessage } from "cloudflare:email";
import { env } from "cloudflare:workers";
import { email } from "renkin/cloudflare";
import { defineWorker } from "renkin/worker";
import { Audit } from "#test-fixtures/full-graph/shared/resources.ts";

export default defineWorker(
  {
    Audit,
    Mail: email(),
  },
  ({ Audit, Mail }) => ({
    async fetch(request) {
      if (request.method === "GET") {
        const id = new URL(request.url).pathname.slice(1);
        return Response.json({
          attempts: await Audit.native.get(`attempts:${id}`),
          accepted: await Audit.native.get(`notified:${id}`),
        });
      }
      const { id } = (await request.json()) as { id: string };
      await Audit.native.put(
        `attempts:${id}`,
        String(Number((await Audit.native.get(`attempts:${id}`)) ?? 0) + 1),
      );
      const from = String(env.MAIL_FROM);
      const to = String(env.MAIL_TO);
      await Mail.native.send(
        new EmailMessage(
          from,
          to,
          `From: ${from}\r\nTo: ${to}\r\nMessage-ID: <${id}@example.com>\r\nSubject: Order ${id}\r\n\r\nOrder completed`,
        ),
      );
      await Audit.native.put(`notified:${id}`, "yes");
      return new Response("Captured notification");
    },
    async queue(batch) {
      for (const message of batch.messages) {
        await Audit.native.put("dead-letter", JSON.stringify(message.body));
        message.ack();
      }
    },
  }),
);
