import { decodeBytes, type GatewayRequest } from "./state-protocol.ts";

export interface WorkerOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly tag?: string;
  readonly existed?: boolean;
  readonly subdomain?: Record<string, boolean>;
}
interface PreparedWorkerOperation {
  readonly operation: WorkerOperation;
  readonly headers: NonNullable<RequestInit["headers"]>;
  readonly body: NonNullable<RequestInit["body"]> | undefined;
  readonly completedResult?: unknown;
}
/** Attach proof to the exact upload, so observing it proves this dispatch was applied. */
export const prepareWorkerOperation = async (
  url: URL,
  mutation: GatewayRequest,
  authorization: string,
): Promise<PreparedWorkerOperation> => {
  const headers = new Headers({ authorization });
  if (mutation.assetUploadToken)
    headers.set("authorization", `Bearer ${mutation.assetUploadToken}`);
  if (mutation.headers?.["content-type"])
    headers.set("content-type", mutation.headers["content-type"]);
  const id = crypto.randomUUID();
  let body: NonNullable<RequestInit["body"]> | undefined =
    mutation.bodyBase64 === undefined ? undefined : decodeBytes(mutation.bodyBase64);
  let operation: WorkerOperation = { id, method: mutation.method, path: url.toString() };
  const isWorker = /\/workers\/scripts\/[^/]+$/.test(url.pathname);
  if (isWorker && mutation.method === "PUT" && body) {
    const form = await new Request(url, { method: "PUT", headers, body }).formData();
    const metadataPart = form.get("metadata");
    if (metadataPart === null) throw new Error("Worker upload lacks metadata.");
    const metadata = JSON.parse(
      typeof metadataPart === "string" ? metadataPart : await metadataPart.text(),
    ) as { tags?: string[] };
    const tag = `renkin-operation:${id}`;
    metadata.tags = [
      ...(metadata.tags ?? []).filter((value) => !value.startsWith("renkin-operation:")),
      tag,
    ];
    form.set("metadata", JSON.stringify(metadata));
    headers.delete("content-type");
    body = form;
    operation = { ...operation, tag };
  }
  if (isWorker && mutation.method === "DELETE") {
    const existing = await fetch(`${url.origin}${url.pathname}/settings`, {
      headers: { authorization },
      redirect: "manual",
    });
    if (await workerNotFound(existing)) return { operation, headers, body, completedResult: {} };
    if (!existing.ok) throw new Error("Cannot establish Worker identity before deletion.");
    operation = { ...operation, existed: true };
  }
  if (/\/workers\/scripts\/[^/]+\/subdomain$/.test(url.pathname) && mutation.method === "POST")
    return prepareSubdomain(operation, headers, body, mutation, authorization);
  return { operation, headers, body };
};

/** Unknown outcomes stay quarantined. An absent PUT is not evidence it cannot arrive later. */
export const workerOperationCompleted = async (
  operation: WorkerOperation,
  authorization: string,
): Promise<boolean> => {
  if (!operation.tag && !operation.existed && !operation.subdomain) return false;
  const url = new URL(operation.path);
  const observed = await fetch(
    operation.subdomain ? url : `${url.origin}${url.pathname}/settings`,
    {
      headers: { authorization },
      redirect: "manual",
    },
  );
  if (operation.method === "DELETE")
    return operation.existed === true && (await workerNotFound(observed));
  if (!observed.ok) return false;
  if (operation.subdomain) {
    const value = (await observed.json()) as { result?: Record<string, unknown> };
    return Object.entries(operation.subdomain).every(
      ([key, expected]) => value.result?.[key] === expected,
    );
  }
  const value = (await observed.json()) as { result?: { tags?: string[] } };
  return !!operation.tag && value.result?.tags?.includes(operation.tag) === true;
};

const workerNotFound = async (value: Response): Promise<boolean> => {
  if (value.status !== 404) return false;
  try {
    const body = (await value.json()) as { errors?: { code?: number }[] };
    return body.errors?.some((error) => error.code === 10007) === true;
  } catch {
    return false;
  }
};
const prepareSubdomain = async (
  operation: WorkerOperation,
  headers: NonNullable<RequestInit["headers"]>,
  body: NonNullable<RequestInit["body"]> | undefined,
  mutation: GatewayRequest,
  authorization: string,
): Promise<PreparedWorkerOperation> => {
  if (!mutation.bodyBase64) throw new Error("Missing subdomain settings.");
  const desired = JSON.parse(new TextDecoder().decode(decodeBytes(mutation.bodyBase64))) as Record<
    string,
    unknown
  >;
  if (
    typeof desired.enabled !== "boolean" ||
    Object.entries(desired).some(
      ([key, value]) =>
        !["enabled", "previews_enabled"].includes(key) || typeof value !== "boolean",
    )
  )
    throw new Error("Invalid subdomain settings.");
  const existing = await fetch(operation.path, { headers: { authorization }, redirect: "manual" });
  if (!existing.ok) throw new Error("Cannot establish subdomain state before mutation.");
  const value = (await existing.json()) as { result?: Record<string, unknown> };
  // If already equal, do not send a delayed duplicate that could overwrite a later deployment.
  if (Object.entries(desired).every(([key, expected]) => value.result?.[key] === expected))
    return { operation, headers, body, completedResult: value.result };
  return {
    operation: { ...operation, subdomain: desired as Record<string, boolean> },
    headers,
    body,
  };
};
