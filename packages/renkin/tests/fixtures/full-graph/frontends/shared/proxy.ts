import { env } from "cloudflare:workers";

interface Service {
  fetch(request: Request): Promise<Response>;
}
export const proxy = async (request: Request) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  const service = (
    url.pathname === "/login" ? env.AUTH : url.pathname === "/tracking" ? env.TRACKING : env.API
  ) as Service;
  return service.fetch(new Request(url, request));
};
