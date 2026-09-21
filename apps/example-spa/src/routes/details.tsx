import { createFileRoute, Link } from "@tanstack/solid-router";
export const Route = createFileRoute("/details")({ component: Details });
function Details() {
  return (
    <main>
      <h1>SPA details</h1>
      <p>Client navigation and direct routing both work.</p>
      <Link to="/">Back home</Link>
    </main>
  );
}
