import type { WorkerUpload } from "@renkin/cloudflare-sdk/services/cloudflare-client/cloudflare-client";
import type { createSiteClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { ResourceState } from "@renkin/core/models/state";
import { Effect } from "effect";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid prepared Worker artifact.");
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid prepared Worker artifact value.");
  return value;
};
const contentType = (path: string) => {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return (
    (
      {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".txt": "text/plain",
        ".xml": "application/xml",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".wasm": "application/wasm",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
};

/** Upload content-addressed assets before the final fenced Worker publication. */
export const prepareWorkerPublication = async (
  resource: ResourceState,
  client: ReturnType<typeof createSiteClient>,
  token: string,
): Promise<{
  readonly files: File[];
  readonly metadata: Partial<NonNullable<WorkerUpload["metadata"]>>;
}> => {
  const properties = object(resource.definition.properties);
  const mainModule =
    typeof properties.mainModule === "string" ? properties.mainModule : "worker.mjs";
  const files = [
    new File([text(properties.source)], mainModule, { type: "application/javascript+module" }),
  ];
  for (const value of Array.isArray(properties.modules) ? properties.modules : []) {
    const module = object(value);
    files.push(
      new File([Buffer.from(text(module.content), "base64")], text(module.name), {
        type: text(module.type),
      }),
    );
  }
  const metadata: Partial<NonNullable<WorkerUpload["metadata"]>> = { mainModule };
  if (properties.observability)
    metadata.observability = object(properties.observability) as unknown as NonNullable<
      NonNullable<WorkerUpload["metadata"]>["observability"]
    >;
  if (properties.assets) {
    const assets = object(properties.assets);
    const entries = Object.entries(object(assets.files)).map(([path, value]) => {
      const asset = object(value);
      return {
        path,
        hash: text(asset.hash),
        size: Number(asset.size),
        content: text(asset.content),
      };
    });
    const manifest = Object.fromEntries(
      entries.map((asset) => [asset.path, { hash: text(asset.hash), size: Number(asset.size) }]),
    );
    const session = await Effect.runPromise(
      client.createAssetSession(resource.physicalId, manifest, token),
    );
    if (!session.jwt) throw new Error("Cloudflare did not return an asset upload session.");
    let jwt: string = session.jwt;
    for (const bucket of session.buckets ?? []) {
      const body = Object.fromEntries(
        bucket.map((hash) => {
          const asset = entries.find((item) => item.hash === hash);
          if (!asset)
            throw new Error("Cloudflare requested an asset outside the prepared manifest.");
          return [hash, new File([text(asset.content)], hash, { type: contentType(asset.path) })];
        }),
      );
      const uploaded = await Effect.runPromise(client.uploadAssets(body, jwt, token));
      if (uploaded.jwt) jwt = uploaded.jwt;
    }
    metadata.assets = { jwt, config: object(assets.config) };
    metadata.bindings = [{ type: "assets", name: text(assets.binding) }];
  }
  return { files, metadata };
};

/** rc.12 upload metadata omits redact_query_string; the settings API accepts it explicitly. */
export const finalizeWorkerPublication = async (
  resource: ResourceState,
  client: ReturnType<typeof createSiteClient>,
  token: string,
): Promise<void> => {
  const properties = object(resource.definition.properties);
  if (properties.observability) {
    const desired = object(properties.observability);
    if (typeof desired.redactQueryString === "boolean") {
      await Effect.runPromise(
        client.patchWorkerSettings(
          resource.physicalId,
          { observability: { redact_query_string: desired.redactQueryString } },
          token,
        ),
      );
    }
  }
  await Effect.runPromise(
    client.setWorkerSubdomain(resource.physicalId, properties.workersDev !== false, token),
  );
};
