import { defineWorker } from "@carere/renkin/worker";
import { Sessions } from "#test-fixtures/full-graph/shared/resources.ts";

export default defineWorker({ Sessions }, ({ Sessions }) => ({
  async fetch(request) {
    if (new URL(request.url).pathname === "/login") {
      await Sessions.native.put("local-demo", "demo-user");
      return Response.json({ token: "local-demo" });
    }
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const user = token ? await Sessions.native.get(token) : null;
    return user ? Response.json({ user }) : new Response("Unauthorized", { status: 401 });
  },
}));
