import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "@renkin/core/models/stack";
import { AwsClient } from "aws4fetch";
import { Effect } from "effect";
import { defineStack, deploy, removeEnvironment } from "renkin";
import { r2, r2Token, worker } from "renkin/cloudflare";

const authorization = () => {
  const prefix = process.env.RENKIN_CLOUDFLARE_TEST_PREFIX;
  if (
    process.env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    process.env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    process.env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_ENABLED !== "true" ||
    !process.env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN ||
    !prefix ||
    !(Date.parse(process.env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "") > Date.now())
  )
    throw new Error(
      "Cloud R2 tests require current explicit product, token management, prefix and expiry authorization.",
    );
  return prefix;
};
export const cloudRecord = (value: Json | undefined): Record<string, Json> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Missing cloud resource output.");
  return value as Record<string, Json>;
};
export const cloudString = (value: Json | undefined): string => {
  if (typeof value !== "string") throw new Error("Missing cloud resource field.");
  return value;
};
export const cloudR2Sign = (
  output: Record<string, Json>,
  bucket: string,
  key: string,
  method = "GET",
) =>
  new AwsClient({
    accessKeyId: cloudString(output.accessKeyId),
    secretAccessKey: cloudString(output.secretAccessKey),
    service: "s3",
    region: "auto",
  }).sign(
    `${cloudString(output.endpoint)}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
    { method, aws: { signQuery: true } },
  );
export const eventuallyR2 = async (stage: string, read: () => Promise<Response>) => {
  let status: number | undefined;
  let code: string | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await read().catch(() => undefined);
    if (response?.ok) return response;
    status = response?.status;
    code = (await response?.text())?.match(/<Code>([A-Za-z0-9]{1,80})<\/Code>/)?.[1];
    if (attempt === 0)
      process.stdout.write(
        `Cloud R2 ${stage}: status=${status ?? "unavailable"}, code=${code ?? "none"}\n`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Cloud R2 ${stage} did not become ready: status=${status ?? "unavailable"}, code=${code ?? "none"}.`,
  );
};
const source = `import {Effect} from "effect";import {r2,r2Token} from "renkin/cloudflare";import {defineWorker} from "renkin/worker";import {AwsClient} from "aws4fetch";
const Files=r2("Files");const Uploads=r2Token("Uploads",{buckets:[Files],permissions:"read-write",expiresAt:"2099-01-01T00:00:00Z"});
export default defineWorker({Files,Uploads},({Files,Uploads})=>({fetch:request=>Effect.promise(async()=>{
 const url=new URL(request.url);const key=url.searchParams.get("key")??"folder/a %2F café";
 if(url.pathname==="/health")return new Response("ready");
 if(url.pathname==="/sign"){const config=Uploads.forRequest(request);const signer=new AwsClient({...config,service:"s3"});const bucket=config.buckets.Files;if(!bucket)throw new Error("Missing credential bucket");if(key.split("/").some(part=>part==="."||part===".."))return new Response("Unsupported key",{status:400});const target=new URL(encodeURIComponent(bucket)+"/"+key.split("/").map(encodeURIComponent).join("/"),config.endpoint).href;const signed=await signer.sign(target,{method:url.searchParams.get("method")??"GET",...(url.searchParams.get("method")==="PUT"?{headers:{"content-type":"text/plain","x-amz-meta-source":"s3"}}:{}),aws:{signQuery:true}});return Response.json({url:signed.url});}
 if(request.method==="PUT"){await Files.native.put(key,await request.text(),{httpMetadata:{contentType:"text/plain",cacheControl:"max-age=60"},customMetadata:{source:"native"}});return new Response("stored");}
 const object=await Files.native.get(key);if(!object)return new Response("missing",{status:404});return Response.json({text:await object.text(),metadata:object.customMetadata,etag:object.httpEtag});
})}));`;
const cloudStack = (
  name: string,
  entry: string,
  allowDelete: boolean,
  forceDestroy: boolean,
  readOnly: boolean,
) => {
  const Files = r2("Files", {
    allowDelete,
    forceDestroy,
    cors: [
      {
        allowed: {
          origins: ["https://app.example"],
          methods: ["GET", "PUT", "HEAD"],
          headers: ["content-type"],
        },
        exposeHeaders: ["etag"],
        maxAgeSeconds: 120,
      },
    ],
  });
  return defineStack({
    name,
    resources: [
      Files,
      r2Token("Uploads", {
        buckets: [Files],
        permissions: readOnly ? "read-only" : "read-write",
        expiresAt: new Date(Date.parse(process.env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? ""))
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        allowDelete,
      }),
      worker("Api", { entry, compatibilityDate: "2026-07-30" }),
    ],
  });
};

export const createCloudR2Fixture = async () => {
  const prefix = authorization();
  const name = `${prefix}-r2-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(fileURLToPath(new URL("../../fixtures/r2-cloud-", import.meta.url)));
  const entry = join(root, "worker.ts");
  await writeFile(entry, source);
  const originalFetch = globalThis.fetch;
  const started = Date.now();
  let cleaning = false;
  globalThis.fetch = (async (input, init) => {
    if (!cleaning && Date.now() - started > 240000)
      throw new Error("Cloud R2 scenario deadline reached; starting cleanup.");
    const timeout = AbortSignal.timeout(20000);
    return originalFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    }).catch(() => {
      throw new Error("Cloud R2 HTTP request failed.");
    });
  }) as typeof fetch;
  const cloudflare = {
    stateScriptName: `${prefix}-state-v2`,
    tokenManagementApiToken: process.env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN ?? "",
  };
  const options = (environment: string) => ({
    environment,
    yes: true,
    cloudflare,
    progress: ({ id, kind }: { id: string; kind: string }) =>
      console.info(`Cloud R2 ${environment} ${kind}: ${id}`),
  });
  const environments = new Set<string>();
  const apply = (environment: string, allowDelete = false, forceDestroy = false) => {
    authorization();
    environments.add(environment);
    return Effect.runPromise(
      deploy(
        cloudStack(name, entry, allowDelete, forceDestroy, environment === "preview-b"),
        options(environment),
      ),
    );
  };
  const remove = async (environment: string) => {
    authorization();
    await Effect.runPromise(removeEnvironment(name, options(environment)));
    environments.delete(environment);
  };
  const close = async () => {
    cleaning = true;
    const failed: string[] = [];
    try {
      for (const environment of environments) {
        try {
          await apply(environment, true, true);
          await remove(environment);
        } catch {
          failed.push(environment);
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
    if (failed.length)
      throw new Error(
        `Cloud R2 cleanup requires inspection of exact owned environments ${name}: ${failed.join(", ")}`,
      );
    process.stdout.write(`Cloud R2 cleanup completed: ${name}\n`);
  };
  process.stdout.write(`Cloud R2 test ownership: ${name}/preview-a,preview-b\n`);
  return { name, cloudflare, options, apply, remove, close };
};
