import { AwsClient } from "aws4fetch";
import { defineWorker, workerReference } from "renkin/worker";
import { Files, Orders, PendingOrders, UploadToken } from "../shared/resources.ts";

export default defineWorker(
  { Auth: workerReference("Auth"), Orders, Files, PendingOrders, UploadToken },
  ({ Auth, Orders, Files, PendingOrders, UploadToken }) => ({
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") return new Response("API ready");
      const authorized = await Auth.native.fetch(
        new Request("https://auth/check", { headers: request.headers }),
      );
      if (!authorized.ok) return authorized;
      if (url.pathname === "/presign") {
        const credentials = UploadToken.forRequest(request);
        const endpoint = new URL(`${credentials.buckets.Files}/order.txt`, credentials.endpoint);
        const signer = new AwsClient({ ...credentials, service: "s3" });
        const signed = await signer.sign(endpoint.href, {
          method: url.searchParams.get("method") ?? "GET",
          aws: { signQuery: true },
        });
        return Response.json({ url: signed.url });
      }
      if (url.pathname === "/file")
        return new Response((await (await Files.native.get("order.txt"))?.text()) ?? "missing");
      if (request.method === "POST") {
        const body = (await request.json()) as { id: string; poison?: boolean };
        await Orders.native.prepare("INSERT INTO orders (id) VALUES (?)").bind(body.id).run();
        await PendingOrders.native.send(body);
        return Response.json({ id: body.id }, { status: 202 });
      }
      return Response.json(
        (await Orders.native.prepare("SELECT id,status FROM orders ORDER BY id").all()).results,
      );
    },
  }),
);
