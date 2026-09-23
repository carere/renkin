import { resourceOutput, secret } from "@carere/renkin";
import {
  accessApplication,
  astro,
  r2,
  r2Token,
  type SiteEnvironment,
  tanstackStart,
  worker,
} from "@carere/renkin/cloudflare";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { expectTypeOf } from "vitest";

const access = accessApplication("access", { domain: "review.example.test" });
const bindings = { AUTH: secret("AUTH_SECRET"), AUD: resourceOutput(access, "aud") };
const start = tanstackStart("start", {
  root: ".",
  rendering: "ssr",
  compatibilityDate: "2026-07-30",
  bindings,
});
const site = astro("astro", {
  root: ".",
  output: "server",
  compatibilityDate: "2026-07-30",
  bindings,
});
expectTypeOf<SiteEnvironment<typeof start>["AUTH"]>().toEqualTypeOf<string>();
expectTypeOf<SiteEnvironment<typeof site>["AUD"]>().toEqualTypeOf<string>();
// @ts-expect-error Access output names are checked.
resourceOutput(access, "misspelledAudience");
const token = r2Token("token", {
  buckets: [r2("bucket")],
  permissions: "read-only",
  expiresAt: "2030-01-01T00:00:00Z",
});
worker("worker", {
  compatibilityDate: "2026-07-30",
  bindings: {
    // @ts-expect-error Arrays cannot be bound as text.
    BUCKETS: resourceOutput(token, "buckets"),
  },
});
it.effect("keeps typed secret references classified as secret", () =>
  Effect.sync(() => {
    expect(resourceOutput(token, "secretAccessKey").secret).toBe(true);
  }),
);
