import { createFileRoute } from "@tanstack/solid-router";
import { GraphPage } from "../../../shared/graph-page.tsx";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const context = Route.useRouteContext();
  return <GraphPage title="Console" context={context()} />;
}
