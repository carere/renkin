import type { AccessApplicationInput } from "@renkin/cloudflare-sdk/services/cloudflare-client/access-client";

type Settings = Record<string, unknown>;
const record = (value: unknown): value is Settings =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Compare only supplied fields. Provider-added defaults remain authoritative. */
export const matchesSupplied = (desired: unknown, observed: unknown): boolean => {
  if (desired === undefined) return true;
  if (Array.isArray(desired)) {
    if (!Array.isArray(observed) || desired.length !== observed.length) return false;
    return desired.every((item) => observed.some((actual) => matchesSupplied(item, actual)));
  }
  if (record(desired))
    return (
      record(observed) &&
      Object.entries(desired).every(([key, value]) => matchesSupplied(value, observed[key]))
    );
  return desired === observed;
};

/** Access PUT is replacement-like: retain omitted settings and merge individual CORS fields. */
export const mergeApplicationSettings = (
  observed: Settings,
  desired: AccessApplicationInput,
): AccessApplicationInput => {
  const existing = Object.fromEntries(
    Object.entries(observed).filter(([, value]) => value !== null && value !== undefined),
  );
  return {
    ...existing,
    ...desired,
    ...(desired.corsHeaders === undefined
      ? {}
      : {
          corsHeaders: {
            ...(record(existing.corsHeaders) ? existing.corsHeaders : {}),
            ...desired.corsHeaders,
          },
        }),
  };
};
