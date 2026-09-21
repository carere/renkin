import { decodeBytes, type GatewayRequest, type GatewayResponse } from "./state-protocol.ts";

export interface MutationReceipt {
  readonly operationKey: string;
  readonly requestDigest: string;
  readonly allocationId: string;
  readonly resourceId: string;
  readonly result: GatewayResponse;
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;

/** Only token creation has a one-time response in this slice. No arbitrary replayable mutations. */
export const receiptRequest = async (request: GatewayRequest, accountId: string) => {
  if (request.operationKey === undefined && request.receiptOnly !== true) return undefined;
  const accountToken = request.path === `/accounts/${accountId}/tokens`;
  const prefix = accountToken ? "account-token-create:" : "access-token-create:";
  if (
    request.method !== "POST" ||
    (!accountToken && request.path !== `/accounts/${accountId}/access/service_tokens`) ||
    typeof request.operationKey !== "string" ||
    !request.operationKey.startsWith(prefix) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(request.operationKey.slice(prefix.length))
  )
    throw new Error("Invalid one-time mutation receipt request.");
  const body: unknown = JSON.parse(new TextDecoder().decode(decodeBytes(request.bodyBase64 ?? "")));
  if (!object(body) || typeof object(body)?.name !== "string")
    throw new Error("Invalid token create body.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([request.method, request.path, canonical(body)])),
  );
  return {
    operationKey: request.operationKey,
    allocationId: request.operationKey.slice(prefix.length),
    resourceType: accountToken ? "cloudflare.r2-token" : "cloudflare.access-service-token",
    requestDigest: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
};

export const receiptIntent = (
  state: string | undefined,
  allocationId: string,
  resourceType = "cloudflare.access-service-token",
): string => {
  const current = object(JSON.parse(state ?? "null"));
  const pending = object(current?.pending);
  const desired = object(object(pending?.change)?.desired);
  if (
    pending?.physicalId !== allocationId ||
    pending?.phase !== "apply" ||
    desired?.type !== resourceType ||
    typeof desired.id !== "string"
  )
    throw new Error("Token create receipt does not match the persisted resource intent.");
  return desired.id;
};

export const receiptAcknowledgements = (
  state: string,
): { key: string; resource: Record<string, unknown> }[] => {
  let current: Record<string, unknown> | undefined;
  try {
    current = object(JSON.parse(state));
  } catch {
    return [];
  }
  const candidates = [
    ...Object.values(object(current?.resources) ?? {}),
    object(object(current?.pending)?.applied),
  ];
  return candidates.flatMap((candidate) => {
    const resource = object(candidate);
    if (
      !["cloudflare.access-service-token", "cloudflare.r2-token"].includes(
        String(object(resource?.definition)?.type),
      )
    )
      return [];
    const key = object(resource?.outputs)?.creationReceipt;
    return typeof key === "string" && resource ? [{ key, resource }] : [];
  });
};

export const acknowledgesReceipt = (
  resource: Record<string, unknown>,
  receipt: MutationReceipt,
): boolean => {
  const result = object(
    JSON.parse(new TextDecoder().decode(decodeBytes(receipt.result.bodyBase64))),
  )?.result;
  const output = object(resource.outputs);
  const created = object(result);
  return (
    created?.id === resource.physicalId &&
    (receipt.operationKey.startsWith("account-token-create:")
      ? typeof created?.value === "string" &&
        output?.value === created.value &&
        output?.accessKeyId === created.id
      : typeof created?.client_secret === "string" &&
        output?.clientSecret === created.client_secret &&
        output?.clientId === created.client_id) &&
    output?.creationReceipt === receipt.operationKey &&
    object(resource.definition)?.id === receipt.resourceId
  );
};
