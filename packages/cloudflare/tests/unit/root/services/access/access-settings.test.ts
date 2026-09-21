import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  matchesSupplied,
  mergeApplicationSettings,
} from "../../../../../src/contexts/root/services/access/access-settings.ts";

describe("Access partial desired settings", () => {
  it.effect(
    "preserves omitted provider fields while merging supplied CORS and explicit false",
    () =>
      Effect.sync(() => {
        const observed = {
          name: "app",
          eagerRedirectCookieSetting: true,
          sessionDuration: "8h",
          corsHeaders: {
            allowedOrigins: ["https://app.example"],
            allowedHeaders: ["x-one"],
            allowCredentials: true,
            maxAge: 600,
          },
        };
        const merged = mergeApplicationSettings(observed, {
          corsHeaders: { allowedHeaders: [], allowCredentials: false },
          eagerRedirectCookieSetting: false,
        });
        expect(merged).toEqual({
          ...observed,
          eagerRedirectCookieSetting: false,
          corsHeaders: { ...observed.corsHeaders, allowedHeaders: [], allowCredentials: false },
        });
        expect(mergeApplicationSettings(observed, { sessionDuration: "1h" }).corsHeaders).toEqual(
          observed.corsHeaders,
        );
        expect(
          matchesSupplied({ corsHeaders: { allowedOrigins: ["https://app.example"] } }, observed),
        ).toBe(true);
        expect(matchesSupplied({ eagerRedirectCookieSetting: false }, observed)).toBe(false);
        expect(matchesSupplied({ corsHeaders: { allowedHeaders: [] } }, observed)).toBe(false);
      }),
  );
});
