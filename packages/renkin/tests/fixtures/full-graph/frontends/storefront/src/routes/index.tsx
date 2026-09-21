import { createFileRoute } from "@tanstack/solid-router";
import { GraphPage } from "../../../shared/graph-page.tsx";
import { health } from "../contexts/root/health.tsx";
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
