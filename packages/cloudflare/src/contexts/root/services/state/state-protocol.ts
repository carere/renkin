import type { ReconciliationDecision } from "./reconciliation.ts";
export interface GatewayRequest {
  readonly method: string;
  readonly path: string;
  readonly bodyBase64?: string;
  readonly headers?: Record<string, string>;
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
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
export const decodeBytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
