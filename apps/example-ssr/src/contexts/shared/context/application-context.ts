import { QueryClient } from "@tanstack/solid-query";
import { type Layer, ManagedRuntime } from "effect";
import type { CounterService } from "#src/contexts/root/services/counter/counter-service.ts";

/** Each router owns its runtime and cache; SSR creates a router for each request. */
export const createApplicationContext = (services: Layer.Layer<CounterService>) => {
  const queryClient = new QueryClient();
  const runtime = ManagedRuntime.make(services);
  return {
    queryClient,
    runtime,
    dispose: async () => {
      queryClient.clear();
      await runtime.dispose();
    },
  };
};
export type ApplicationContext = ReturnType<typeof createApplicationContext>;
