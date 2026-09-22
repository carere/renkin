declare module "cloudflare:workers" {
  const env: import("renkin/cloudflare").SiteEnvironment<typeof import("../../resources.ts").site>;

  export { env };
}
