import handler from "@tanstack/solid-start/server-entry";
export default {
  async fetch(request: Request) {
    const response = await handler.fetch(request);
    response.headers.set("x-renkin-example-entry", "custom");
    return response;
  },
};
