import type { KVRequirement } from "@renkin/runtime/models/binding";
import type { NativeBindings } from "@renkin/runtime/models/native-bindings";
import type { AstroOptions } from "./astro.ts";
import type { FrameworkWorkerOptions } from "./framework-worker.ts";

type Bindings<O extends FrameworkWorkerOptions> = O extends { readonly bindings: infer B }
  ? B extends NonNullable<FrameworkWorkerOptions["bindings"]>
    ? B
    : never
  : Record<never, never>;

type Session<O extends AstroOptions> = O extends { readonly output: "server" }
  ? O extends { readonly sessionKVBindingName: false }
    ? Record<never, never>
    : Record<
        O extends { readonly sessionKVBindingName: infer Name extends string } ? Name : "SESSION",
        KVRequirement
      >
  : Record<never, never>;

/** Infer native server bindings from a site declaration, using type-only imports. */
export type SiteEnvironment<
  Site extends { readonly website: FrameworkWorkerOptions } | { readonly astro: AstroOptions },
> = Site extends { readonly website: infer O extends FrameworkWorkerOptions }
  ? NativeBindings<Bindings<O>>
  : Site extends { readonly astro: infer O extends AstroOptions }
    ? NativeBindings<Bindings<O> & Session<O>>
    : never;
