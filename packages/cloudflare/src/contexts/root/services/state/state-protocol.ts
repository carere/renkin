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
export const encodeBytes = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  return btoa(parts.join(""));
};
export const decodeBytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
