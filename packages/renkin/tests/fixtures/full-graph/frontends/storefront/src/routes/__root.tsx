import { QueryClientProvider } from "@tanstack/solid-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { onCleanup } from "solid-js";
import { HydrationScript } from "solid-js/web";
import type { GraphContext } from "#test-fixtures/full-graph/frontends/shared/context.ts";
export const Route = createRootRouteWithContext<GraphContext>()({ component: Root });
function Root() {
  const context = Route.useRouteContext();
  onCleanup(() => {
    void context().runtime.dispose();
  });
  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={context().queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
