import type { R2HTTPMetadata, R2Object } from "@cloudflare/workers-types";
import { unsupported } from "./s3-error.ts";

const fields = {
  "content-type": "contentType",
  "content-language": "contentLanguage",
  "content-disposition": "contentDisposition",
  "content-encoding": "contentEncoding",
  "cache-control": "cacheControl",
} as const;
const overrides = new Set([...Object.keys(fields), "expires"]);
const authentication = new Set([
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-SignedHeaders",
  "X-Amz-Signature",
]);
export const validateQueries = (url: URL) => {
  for (const key of url.searchParams.keys())
    if (
      !authentication.has(key) &&
      key !== "x-id" &&
      !key.startsWith("x-amz-meta-") &&
      !(key.startsWith("response-") && overrides.has(key.slice(9)))
    )
      throw unsupported();
};
export const uploadMetadata = (request: Request, url: URL) => {
  const httpMetadata: R2HTTPMetadata = {};
  const customMetadata: Record<string, string> = {};
  for (const [name, value] of request.headers) {
    if (
      name.startsWith("x-amz-server-side-encryption") ||
      name.startsWith("x-amz-checksum-") ||
      name === "x-amz-storage-class" ||
      name === "content-md5" ||
      (name === "content-encoding" &&
        value
          .toLowerCase()
          .split(/\s*,\s*/)
          .includes("aws-chunked"))
    )
      throw unsupported();
    if (name.startsWith("x-amz-meta-")) customMetadata[name.slice(11)] = value;
  }
  for (const [name, field] of Object.entries(fields)) {
    const value = request.headers.get(name);
    if (value !== null) httpMetadata[field] = value;
  }
  const expires = request.headers.get("expires");
  if (expires && Number.isFinite(Date.parse(expires))) httpMetadata.cacheExpiry = new Date(expires);
  for (const [name, value] of url.searchParams)
    if (name.startsWith("x-amz-meta-")) customMetadata[name.slice(11)] = value;
  return { httpMetadata, customMetadata };
};
export const objectHeaders = (object: R2Object, url: URL): Headers => {
  const headers = new Headers({
    etag: object.httpEtag,
    "last-modified": object.uploaded.toUTCString(),
    "accept-ranges": "bytes",
    "content-length": String(object.size),
  });
  for (const [name, field] of Object.entries(fields)) {
    const value = object.httpMetadata?.[field];
    if (value !== undefined) headers.set(name, value);
  }
  if (object.httpMetadata?.cacheExpiry)
    headers.set("expires", object.httpMetadata.cacheExpiry.toUTCString());
  for (const [name, value] of Object.entries(object.customMetadata ?? {}))
    headers.set(`x-amz-meta-${name}`, value);
  for (const name of overrides) {
    const value = url.searchParams.get(`response-${name}`);
    if (value !== null) headers.set(name, value);
  }
  return headers;
};
