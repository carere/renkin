import type { ReconciliationDecision } from "./reconciliation.ts";
export interface GatewayRequest {
  readonly method: string;
  readonly path: string;
  readonly bodyBase64?: string;
  readonly headers?: Record<string, string>;
  readonly assetUploadToken?: string;
  readonly operationKey?: string;
  readonly receiptOnly?: boolean;
}
export interface GatewayResponse {
  readonly status: number;
  readonly bodyBase64: string;
  readonly headers: Record<string, string>;
}
export interface CoordinatorRequest {
  readonly stack: string;
  readonly environment?: string;
  readonly token?: string;
  readonly state?: string;
  readonly request?: GatewayRequest;
  readonly decision?: ReconciliationDecision;
}
// Workers and Bun support native conversion, avoiding whole-checkpoint binary strings.
export const encodeBytes = (bytes: Uint8Array): string => {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  // Older host engines need a fallback. Multiples of three avoid padding between chunks.
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_766)
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32_766))));
  return parts.join("");
};
export const decodeBytes = (value: string): Uint8Array<ArrayBuffer> => {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(value);
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
