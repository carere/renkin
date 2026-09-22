import type { BuildReuseOptions, BuildValue } from "@renkin/runtime/models/build-reuse";

/** Unknown closures require a caller-supplied identity and explicit captured inputs. */
export const buildIdentity = (value: unknown, reuse: BuildReuseOptions | false | undefined) => {
  let opaque = false;
  const visit = (value: unknown): BuildValue => {
    if (value === undefined) return null;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof URL) return value.href;
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    opaque = true;
    return null;
  };
  const values = visit(value);
  const explicit = reuse || {};
  return {
    values,
    cacheable: !opaque || !!(explicit.key && (explicit.inputs?.length || explicit.values)),
  };
};
