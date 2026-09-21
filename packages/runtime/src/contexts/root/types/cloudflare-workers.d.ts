/** Runtime module supplied by workerd; signatures come from the installed official types. */
declare module "cloudflare:workers" {
  export const WorkflowEntrypoint: typeof import("@cloudflare/workers-types").CloudflareWorkersModule.WorkflowEntrypoint;
}
