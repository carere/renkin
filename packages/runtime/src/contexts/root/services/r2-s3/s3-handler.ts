import { type LocalR2S3Options, localR2S3Path } from "../../models/local-r2-s3.ts";
import type { NativeR2 } from "../../models/r2.ts";
import { errorResponse, invalidArgument, S3Error, unsupported } from "./s3-error.ts";
import { objectHeaders, uploadMetadata, validateQueries } from "./s3-metadata.ts";
import { parseRange } from "./s3-range.ts";
import { verifyPresignedRequest } from "./sigv4.ts";

const cors = (response: Response, request: Request): Response => {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-expose-headers", "*");
  response.headers.set("access-control-allow-methods", "GET, HEAD, PUT, OPTIONS");
  response.headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ?? "*",
  );
  response.headers.set("vary", "Access-Control-Request-Headers");
  return response;
};
const path = (url: URL) => {
  const rest = url.pathname.slice(localR2S3Path.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) throw unsupported();
  try {
    return {
      bucket: decodeURIComponent(rest.slice(0, slash)),
      key: decodeURIComponent(rest.slice(slash + 1)),
    };
  } catch {
    throw invalidArgument();
  }
};
const read = async (bucket: NativeR2, key: string, request: Request, url: URL) => {
  const metadata = await bucket.head(key);
  if (!metadata) throw new S3Error(404, "NoSuchKey", "The specified key does not exist.");
  const range = parseRange(request.headers.get("range"), metadata.size);
  if (range === "invalid") {
    const response = errorResponse(
      new S3Error(416, "InvalidRange", "The requested range is not satisfiable."),
      request.method === "HEAD",
    );
    response.headers.set("content-range", `bytes */${metadata.size}`);
    return response;
  }
  const object =
    request.method === "HEAD" ? metadata : await bucket.get(key, range ? { range } : {});
  if (!object) throw new S3Error(404, "NoSuchKey", "The specified key does not exist.");
  const headers = objectHeaders(object, url);
  if (range) {
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
    headers.set("content-length", String(range.length));
  }
  return new Response("body" in object ? (object.body as unknown as ReadableStream) : null, {
    status: range ? 206 : 200,
    headers,
  });
};
export const handleLocalR2S3 = async (
  request: Request,
  buckets: Readonly<Record<string, NativeR2>>,
  credentials: LocalR2S3Options,
): Promise<Response> => {
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request);
  try {
    await verifyPresignedRequest(request, credentials);
    const url = new URL(request.url);
    validateQueries(url);
    if (!["GET", "HEAD", "PUT"].includes(request.method)) throw unsupported();
    const target = path(url);
    if (!Object.hasOwn(buckets, target.bucket))
      throw new S3Error(404, "NoSuchBucket", "The specified bucket does not exist.");
    const bucket = buckets[target.bucket];
    if (!bucket) throw new S3Error(404, "NoSuchBucket", "The specified bucket does not exist.");
    if (request.method === "PUT") {
      const object = await bucket.put(
        target.key,
        request.body as unknown as Parameters<NativeR2["put"]>[1],
        uploadMetadata(request, url),
      );
      return cors(new Response(null, { headers: { etag: object.httpEtag } }), request);
    }
    return cors(await read(bucket, target.key, request, url), request);
  } catch (error) {
    return cors(errorResponse(error, request.method === "HEAD"), request);
  }
};
