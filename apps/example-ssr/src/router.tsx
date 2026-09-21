import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen.ts";
export const getRouter = () => createRouter({ routeTree });
declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
