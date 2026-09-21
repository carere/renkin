export default {
  fetch(request: Request): Response {
    return new Response(`ordinary:${new URL(request.url).pathname}`);
  },
};
