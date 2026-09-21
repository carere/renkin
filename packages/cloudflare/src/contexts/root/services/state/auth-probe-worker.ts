import { StateCoordinator } from "./coordinator-worker.ts";

// Edge preview of an existing DO-owning script must retain its named class export.
export { StateCoordinator };

/** Uploaded only as an authenticated preview, never as the deployed account service. */
export default {
  fetch(_request: Request, env: { readonly RENKIN_STATE_AUTH?: string }): Response {
    if (!env.RENKIN_STATE_AUTH)
      return new Response("State authorization unavailable.", { status: 503 });
    return new Response(env.RENKIN_STATE_AUTH, {
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    });
  },
};
