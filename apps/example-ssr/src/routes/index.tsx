import { useQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, ErrorBoundary, onMount, Suspense } from "solid-js";
import { countQuery } from "#src/contexts/root/queries/count-query.ts";
export const Route = createFileRoute("/")({
  component: Home,
  loader: ({ context }) =>
    context.queryClient.fetchQuery({ ...countQuery(context.runtime), staleTime: Infinity }),
});
function Home() {
  const [ready, setReady] = createSignal(false);
  onMount(() => setReady(true));
  const [clicks, setClicks] = createSignal(0);

  return (
    <main>
      <h1>Renkin Solid SSR</h1>
      <p>{import.meta.env.VITE_APPLICATION ?? "Local framework example"}</p>
      <ErrorBoundary fallback={<p>Could not load the stored count.</p>}>
        <Suspense fallback={<p>Loading stored count…</p>}>
          <StoredCount />
        </Suspense>
      </ErrorBoundary>
      <button type="button" disabled={!ready()} onClick={() => setClicks((value) => value + 1)}>
        Clicks: {clicks()}
      </button>
    </main>
  );
}

function StoredCount() {
  const context = Route.useRouteContext();
  const stored = useQuery(() => countQuery(context().runtime));
  return (
    <p id="native-value">
      Stored count: {stored.data?.value}; stage: {stored.data?.stage}
    </p>
  );
}
