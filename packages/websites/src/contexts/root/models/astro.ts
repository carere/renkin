import { createHash } from "node:crypto";
import { type KVResource, kv } from "@renkin/cloudflare/models/kv";
import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import { validateName } from "@renkin/core/models/stack";
import type { AstroBuildOptions } from "./astro-options.ts";
import { type FrameworkWorkerOptions, frameworkWorker } from "./framework-worker.ts";

export interface AstroOptions extends AstroBuildOptions, FrameworkWorkerOptions {}
export interface AstroResource extends WorkerResource {
  /** The generated or explicitly supplied session namespace, when sessions are enabled. */
  readonly sessionKV?: KVResource;
}

const sessionId = (id: string) =>
  id.length <= 56
    ? `${id}-session`
    : `${id.slice(0, 47)}-${createHash("sha256").update(id).digest("hex").slice(0, 8)}-session`;

/** Declares one Astro Worker and its ordinary protected resource dependencies. */
export const astro = (id: string, options: AstroOptions): AstroResource => {
  validateName(id);
  if (options.bindings?.ASSETS !== undefined)
    throw new Error("ASSETS is reserved for Astro static assets.");
  const name = options.sessionKVBindingName ?? "SESSION";
  if (name !== false && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
    throw new Error("Astro session binding must be a valid binding name.");
  let sessionKV: KVResource | undefined;
  let bindings = options.bindings ?? {};
  if (options.output === "server" && name !== false) {
    const existing = bindings[name];
    if (
      existing !== undefined &&
      (typeof existing === "string" || existing.type !== "cloudflare.kv")
    )
      throw new Error("Astro sessions require a KV binding.");
    if (existing === undefined) {
      sessionKV = kv(sessionId(id), {
        allowDelete: options.allowDelete ?? false,
        ...(options.retain === undefined ? {} : { retain: options.retain }),
      });
      bindings = { ...bindings, [name]: sessionKV };
    } else if ("properties" in existing && "identity" in existing) {
      sessionKV = existing as KVResource;
    }
  }
  const resource = frameworkWorker(
    id,
    { ...options, bindings },
    {
      build: async () => (await import("../services/astro/build-astro.ts")).buildAstro(options),
      develop: async (context) =>
        (await import("../services/astro/develop-astro.ts")).developAstro(options, context),
    },
  );
  return { ...resource, ...(sessionKV ? { sessionKV } : {}) };
};
