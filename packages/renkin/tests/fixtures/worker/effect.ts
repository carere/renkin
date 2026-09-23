import { defineWorker } from "@carere/renkin/worker";
import { Effect } from "effect";

export default defineWorker({
  fetch: (request) => Effect.succeed(new Response(`effect:${new URL(request.url).pathname}`)),
});
