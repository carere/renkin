import { createFileRoute } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { readCount } from "../contexts/root/server/read-count.ts";
export const Route = createFileRoute("/")({ component: Home, loader: () => readCount() });
function Home() {
  const [clicks, setClicks] = createSignal(0);
  const stored = Route.useLoaderData();
  return (
    <main>
      <h1>Renkin Solid SSR</h1>
      <p>{import.meta.env.VITE_APPLICATION ?? "Local framework example"}</p>
      <p id="native-value">
        Stored count: {stored().value}; stage: {stored().stage}
      </p>
      <button type="button" onClick={() => setClicks((value) => value + 1)}>
        Clicks: {clicks()}
      </button>
    </main>
  );
}
