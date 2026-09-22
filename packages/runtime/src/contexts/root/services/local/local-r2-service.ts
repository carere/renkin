import { fileURLToPath } from "node:url";
import type { WorkerOptions } from "miniflare";
import type { Requirements } from "#src/contexts/root/models/binding.ts";
import { type LocalR2S3Options, localR2S3Path } from "#src/contexts/root/models/local-r2-s3.ts";
import { bundleWorker } from "#src/contexts/root/services/bundler/worker-bundler.ts";
import type { LocalGraphOptions } from "./local-graph-service.ts";

export const localR2Credentials = (options: LocalGraphOptions, tokenId: string) => {
  const ids = options.r2Tokens?.[tokenId];
  if (!options.r2S3 || !ids?.length)
    throw new Error(
      "R2 credential bindings require declared buckets and explicit local S3 credentials.",
    );
  if (ids.some((id) => !Object.hasOwn(options.buckets ?? {}, id)))
    throw new Error("Local R2 token bucket is not declared.");
  return {
    ...options.r2S3,
    endpoint: localR2S3Path,
    region: "auto",
    buckets: Object.fromEntries(ids.map((id) => [id, id])),
  };
};
export const localR2GatewayName = (id: string) => `__renkin_r2_s3_${id}`;
export const localR2Source = async (options?: LocalR2S3Options) => {
  if (!options) return undefined;
  if (!options.accessKeyId || !options.secretAccessKey)
    throw new Error("Local R2 S3 credentials must be nonempty.");
  return (
    await bundleWorker(fileURLToPath(new URL("../r2-s3/s3-worker.ts", import.meta.url)), {
      sourceMap: false,
    })
  ).code;
};
/** S3 gateway runs before application/SPA routing, sharing exactly the Worker's declared buckets. */
export const localR2Workers = (
  options: LocalGraphOptions,
  prepared: Readonly<Record<string, { readonly requirements: Requirements }>>,
  source: string | undefined,
): WorkerOptions[] => {
  const workers: WorkerOptions[] = [];
  if (options.buckets && Object.keys(options.buckets).length)
    workers.push({
      name: "__renkin_buckets",
      script: "export default {fetch(){return new Response(null,{status:404})}}",
      modules: true,
      compatibilityDate: "2026-07-30",
      r2Buckets: { ...options.buckets },
    });
  if (!options.r2S3 || !source) return workers;
  for (const worker of options.workers) {
    const buckets: Record<string, string> = {};
    const r2Buckets: Record<string, string> = {};
    for (const requirement of Object.values(prepared[worker.id]?.requirements ?? {})) {
      const ids =
        requirement.type === "cloudflare.r2"
          ? [requirement.id]
          : requirement.type === "cloudflare.r2-token"
            ? Object.keys(localR2Credentials(options, requirement.id).buckets)
            : [];
      for (const logicalId of ids) {
        if (Object.hasOwn(buckets, logicalId)) continue;
        const id = options.buckets?.[logicalId];
        if (!id) throw new Error("Local R2 binding target is not declared.");
        const binding = `R2_${Object.keys(buckets).length}`;
        buckets[logicalId] = binding;
        r2Buckets[binding] = id;
      }
    }
    workers.push({
      name: localR2GatewayName(worker.id),
      script: source,
      modules: true,
      compatibilityDate: "2026-07-30",
      r2Buckets,
      bindings: { RENKIN_S3: { ...options.r2S3, buckets } },
      serviceBindings: { ORIGINAL: worker.id },
      unsafeDirectSockets: [{ host: "127.0.0.1", port: worker.port ?? 0 }],
    });
  }
  return workers;
};
