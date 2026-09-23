import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { MutationGateway } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import { Effect } from "effect";

const gatewayFor = (base: string): MutationGateway => ({
  request: async (request) => {
    const response = await fetch(`${base}${request.path}`, {
      method: request.method,
      headers: request.headers ?? {},
      ...(request.bodyBase64 ? { body: Buffer.from(request.bodyBase64, "base64") } : {}),
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
    };
  },
});

/** Local HTTP boundary for the real Access and Worker adapters; no cloud credentials. */
export const bindingHttp = () =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const requests: string[] = [];
      const uploads: {
        bindings: { name: string; type: string; text: string }[];
        tags: string[];
      }[] = [];
      const applications: Record<string, unknown>[] = [];
      const settings = { audience: "generated-audience", rejectUpload: false };
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const path = new URL(request.url ?? "/", "http://test").pathname;
        const method = request.method ?? "GET";
        requests.push(`${method} ${path}`);
        let result: unknown = {};
        if (path.endsWith("/access/apps")) {
          if (method === "POST") {
            const application = {
              ...JSON.parse(body.toString()),
              id: `app-${applications.length}`,
              aud: settings.audience,
            };
            applications.push(application);
            result = application;
          } else result = applications;
        } else if (path.includes("/access/apps/")) {
          result = {
            ...applications.find((app) => path.endsWith(`/${app.id}`)),
            aud: settings.audience,
          };
        } else if (path.endsWith("/subdomain")) result = { enabled: true, previews_enabled: true };
        else if (method === "PUT") {
          const form = await new Response(body, {
            headers: { "content-type": request.headers["content-type"] ?? "" },
          }).formData();
          const metadata = form.get("metadata");
          uploads.push(
            JSON.parse(
              typeof metadata === "string" ? metadata : ((await metadata?.text()) ?? "{}"),
            ),
          );
        } else result = { tags: uploads.at(-1)?.tags ?? ["renkin:app:test:worker"] };
        const rejected = method === "PUT" && settings.rejectUpload;
        response.writeHead(rejected ? 400 : 200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            rejected
              ? { success: false, errors: [{ code: 10000, message: "secret-provider-echo" }] }
              : { success: true, result },
          ),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
      return {
        server,
        requests,
        uploads,
        settings,
        config: { accountId: "account", apiToken: "test", apiBaseUrl: base },
        gateway: gatewayFor(base),
      };
    }),
    ({ server }) => closeServer(server),
  );
const closeServer = (server: Server) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
