/// <reference types="astro/client" />
declare module "cloudflare:workers" {
  export const env: {
    readonly CONTENT: import("@cloudflare/workers-types").KVNamespace;
    readonly GREETING: string;
  };
}
