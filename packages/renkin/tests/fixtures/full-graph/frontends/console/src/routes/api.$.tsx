import { createFileRoute } from "@tanstack/solid-router";
import { proxy } from "#test-fixtures/full-graph/frontends/shared/proxy.ts";
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: { GET: ({ request }) => proxy(request), POST: ({ request }) => proxy(request) },
  },
});
