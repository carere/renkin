import type { LocalR2S3Options } from "../../models/local-r2-s3.ts";
import { invalidArgument, S3Error } from "./s3-error.ts";

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const encodeQuery = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const query = (url: URL) =>
  [...url.searchParams]
    .filter(([key]) => key !== "X-Amz-Signature")
    .map(([key, value]) => [encodeQuery(key), encodeQuery(value)] as const)
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
const hmac = async (key: ArrayBuffer | Uint8Array<ArrayBuffer>, value: string) => {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
};
const required = (url: URL, name: string): string => {
  const values = url.searchParams.getAll(`X-Amz-${name}`);
  if (values.length !== 1 || !values[0]) throw invalidArgument();
  return values[0];
};
const signingTime = (date: string, expiry: string, now: number) => {
  if (!/^\d{8}T\d{6}Z$/.test(date) || !/^\d+$/.test(expiry)) throw invalidArgument();
  const seconds = Number(expiry);
  const time = Date.parse(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
  );
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().replace(/[-:]/g, "").replace(".000", "") !== date ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > 604800
  )
    throw invalidArgument();
  if (now > time + seconds * 1000) throw new S3Error(403, "ExpiredRequest", "Request has expired.");
  if (time > now + 900000)
    throw new S3Error(403, "RequestTimeTooSkewed", "Request time is too far in the future.");
};
const signedHeaders = (request: Request, url: URL, names: string) => {
  const headers = names.split(";");
  if (
    !headers.includes("host") ||
    new Set(headers).size !== headers.length ||
    headers.join(";") !== [...headers].sort().join(";") ||
    headers.some((name) => !/^[!#$%&'*+.^_`|~a-z0-9-]+$/.test(name))
  )
    throw invalidArgument();
  return headers
    .map((name) => {
      const value = name === "host" ? url.host : request.headers.get(name);
      if (value === null) throw invalidArgument();
      return `${name}:${value.trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
};

/** Verification only: signs nothing for callers, and authenticates before decoding bucket/key. */
export const verifyPresignedRequest = async (
  request: Request,
  credentials: LocalR2S3Options,
  now = Date.now(),
): Promise<void> => {
  const url = new URL(request.url);
  if (request.headers.has("authorization") || url.searchParams.has("X-Amz-Security-Token"))
    throw invalidArgument();
  if (required(url, "Algorithm") !== "AWS4-HMAC-SHA256") throw invalidArgument();
  const date = required(url, "Date");
  const expiry = required(url, "Expires");
  const credential = required(url, "Credential").split("/");
  const names = required(url, "SignedHeaders");
  const signature = required(url, "Signature");
  if (
    credential.length !== 5 ||
    credential[1] !== date.slice(0, 8) ||
    !credential[2] ||
    credential[3] !== "s3" ||
    credential[4] !== "aws4_request" ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw invalidArgument();
  if (credential[0] !== credentials.accessKeyId)
    throw new S3Error(403, "InvalidAccessKeyId", "The access key does not exist.");
  signingTime(date, expiry, now);
  const canonical = [
    request.method,
    url.pathname,
    query(url),
    signedHeaders(request, url, names),
    names,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = credential.slice(1).join("/");
  let key: ArrayBuffer = await hmac(
    encoder.encode(`AWS4${credentials.secretAccessKey}`),
    credential[1] ?? "",
  );
  for (const component of credential.slice(2)) key = await hmac(key, component);
  const verificationKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(signature.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    verificationKey,
    signatureBytes,
    encoder.encode(["AWS4-HMAC-SHA256", date, scope, await digest(canonical)].join("\n")),
  );
  if (!valid)
    throw new S3Error(403, "SignatureDoesNotMatch", "The request signature does not match.");
};
