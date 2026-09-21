import { createFileRoute } from "@tanstack/solid-router";
import { GraphPage } from "#test-fixtures/full-graph/frontends/shared/graph-page.tsx";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const context = Route.useRouteContext();
  return <GraphPage title="Customer Hub" context={context()} />;
}
