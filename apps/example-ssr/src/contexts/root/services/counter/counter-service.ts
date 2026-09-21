import { Context, type Effect } from "effect";

export interface Count {
  readonly value: number;
  readonly stage: string;
}
export class CounterService extends Context.Service<
  CounterService,
  { readonly read: Effect.Effect<Count, Error> }
>()("example-ssr/CounterService") {}
