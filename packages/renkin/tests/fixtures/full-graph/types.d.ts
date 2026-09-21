/** Native workerd modules; the fixture consumes only the public platform APIs. */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
declare module "cloudflare:email" {
  export const EmailMessage: new (
    from: string,
    to: string,
    raw: string,
  ) => import("@cloudflare/workers-types").EmailMessage;
}
