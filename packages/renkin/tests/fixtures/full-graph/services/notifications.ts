import { EmailMessage } from "cloudflare:email";
import { env } from "cloudflare:workers";
import { email } from "renkin/cloudflare";
import { defineWorker } from "renkin/worker";
import { Audit } from "../shared/resources.ts";

export default defineWorker(
  {
    Audit,
    Mail: email(),
  },
  ({ Audit, Mail }) => ({
    async fetch(request) {
      const { id } = (await request.json()) as { id: string };
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
