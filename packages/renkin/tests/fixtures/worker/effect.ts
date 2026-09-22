import { Effect } from "effect";
import { defineWorker } from "renkin/worker";

export default defineWorker({
  fetch: (request) => Effect.succeed(new Response(`effect:${new URL(request.url).pathname}`)),
});
