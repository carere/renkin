declare module "cloudflare:workers" {
  const env: { DATA: import("@cloudflare/workers-types").KVNamespace; STAGE: string };

  export { env };
}
