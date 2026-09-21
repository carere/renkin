import { createFileRoute } from "@tanstack/solid-router";
import { GraphPage } from "#test-fixtures/full-graph/frontends/shared/graph-page.tsx";
import { health } from "#test-fixtures/full-graph/frontends/storefront/src/contexts/root/health.tsx";
export const Route = createFileRoute("/")({ component: Home, loader: () => health() });
function Home() {
  const context = Route.useRouteContext();
  const status = Route.useLoaderData();
  return (
    <>
      <p data-testid="ssr-health">{status()}</p>
      <GraphPage title="Storefront" context={context()} />
    </>
  );
}
