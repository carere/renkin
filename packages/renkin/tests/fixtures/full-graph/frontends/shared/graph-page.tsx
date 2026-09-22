import { useMutation, useQuery } from "@tanstack/solid-query";
import { Effect } from "effect";
import { createSignal, ErrorBoundary, For, onMount, Suspense } from "solid-js";
import { GraphApi, type GraphContext } from "./context.ts";

export const GraphPage = (props: { title: string; context: GraphContext }) => {
  const [ready, setReady] = createSignal(false);
  onMount(() => setReady(true));
  const [authenticated, setAuthenticated] = createSignal(false);
  const [id, setId] = createSignal("order-1");
  const login = useMutation(() => ({
    mutationFn: () =>
      props.context.runtime.runPromise(
        Effect.gen(function* () {
          const api = yield* GraphApi;
          yield* api.fetch("/api/login");
        }),
      ),
    onSuccess: () => setAuthenticated(true),
  }));
  const orders = useQuery(() => ({
    queryKey: ["orders"],
    enabled: authenticated(),
    refetchInterval: 200,
    throwOnError: true,
    queryFn: () =>
      props.context.runtime.runPromise(
        Effect.gen(function* () {
          const api = yield* GraphApi;
          const response = yield* api.fetch("/api/orders");
          return yield* Effect.promise(
            () => response.json() as Promise<{ id: string; status: string }[]>,
          );
        }),
      ),
  }));
  const create = useMutation(() => ({
    mutationFn: (id: string) =>
      props.context.runtime.runPromise(
        Effect.gen(function* () {
          const api = yield* GraphApi;
          yield* api.fetch("/api/orders", { method: "POST", body: JSON.stringify({ id }) });
        }),
      ),
  }));
  const upload = useMutation(() => ({
    mutationFn: () =>
      props.context.runtime.runPromise(
        Effect.gen(function* () {
          const api = yield* GraphApi;
          const putResponse = yield* api.fetch("/api/presign?method=PUT");
          const put = yield* Effect.promise(() => putResponse.json() as Promise<{ url: string }>);
          const response = yield* Effect.promise(() =>
            fetch(put.url, { method: "PUT", body: "browser order attachment" }),
          );
          if (!response.ok) throw new Error(`Signed upload failed (${response.status})`);
          const getResponse = yield* api.fetch("/api/presign");
          const get = yield* Effect.promise(() => getResponse.json() as Promise<{ url: string }>);
          return yield* Effect.promise(async () => await (await fetch(get.url)).text());
        }),
      ),
  }));
  return (
    <main>
      <h1>{props.title}</h1>
      <p>Connected order workflow</p>
      <button type="button" disabled={!ready()} onClick={() => login.mutate()}>
        Sign in locally
      </button>
      <p data-testid="auth">{authenticated() ? "Signed in" : "Signed out"}</p>
      <label>
        Order ID <input value={id()} onInput={(event) => setId(event.currentTarget.value)} />
      </label>
      <button type="button" disabled={!authenticated()} onClick={() => create.mutate(id())}>
        Create order
      </button>
      <button type="button" disabled={!authenticated()} onClick={() => upload.mutate()}>
        Upload attachment
      </button>
      <p data-testid="upload">{upload.data}</p>
      <p>{String(login.error ?? create.error ?? upload.error ?? "")}</p>
      <ErrorBoundary fallback={(error) => <p>{String(error)}</p>}>
        <Suspense fallback={<p>Loading orders</p>}>
          <ul>
            <For each={orders.data}>
              {(order) => (
                <li>
                  {order.id}: {order.status}
                </li>
              )}
            </For>
          </ul>
        </Suspense>
      </ErrorBoundary>
    </main>
  );
};
