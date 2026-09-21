import { dehydrate, hydrate, QueryClientProvider } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { ServerCounterService } from "#src/contexts/root/services/counter/server-counter-service.ts";
import { createApplicationContext } from "#src/contexts/shared/context/application-context.ts";
import { routeTree } from "./routeTree.gen.ts";

export const getRouter = () => {
  const context = createApplicationContext(ServerCounterService);
  const router = createRouter({
    routeTree,
    context,
    dehydrate: () => ({ queries: JSON.stringify(dehydrate(context.queryClient)) }),
    hydrate: (data) => hydrate(context.queryClient, JSON.parse(data.queries)),
    Wrap: (props) => {
      if (!isServer)
        onCleanup(() => {
          void context.dispose();
        });
      return (
        <QueryClientProvider client={context.queryClient}>{props.children}</QueryClientProvider>
      );
    },
  });
  router.serverSsrLifecycle = {
    onServerSsrAttach: [
      (ssr) =>
        ssr.onCleanup(() => {
          void context.dispose();
        }),
    ],
  };
  return router;
};
declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
