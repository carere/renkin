import { createFileRoute } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const [clicks, setClicks] = createSignal(0);
  return (
    <main>
      <h1>Renkin Solid SPA</h1>
      <p>{import.meta.env.VITE_APPLICATION ?? "Local framework example"}</p>
      <button type="button" onClick={() => setClicks((value) => value + 1)}>
        Clicks: {clicks()}
      </button>
    </main>
  );
}
