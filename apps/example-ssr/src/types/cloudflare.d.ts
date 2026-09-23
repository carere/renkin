declare module "cloudflare:workers" {
  const env: import("@carere/renkin/cloudflare").SiteEnvironment<
    typeof import("../../resources.ts").site
  >;

  export { env };
}
