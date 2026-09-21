import { decodeBytes, type GatewayRequest } from "./state-protocol.ts";

export interface WorkerOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly tag?: string;
  readonly existed?: boolean;
}
/** Attach proof to the exact upload, so observing it proves this dispatch was applied. */
export const prepareWorkerOperation = async (
  url: URL,
  mutation: GatewayRequest,
  authorization: string,
) => {
  const headers = new Headers({ authorization });
  if (mutation.headers?.["content-type"])
    headers.set("content-type", mutation.headers["content-type"]);
  const id = crypto.randomUUID();
  let body: BodyInit | undefined =
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
    if (existing.status === 404) return { operation, headers, body, alreadyAbsent: true };
    if (!existing.ok) throw new Error("Cannot establish Worker identity before deletion.");
    operation = { ...operation, existed: true };
  }
  return { operation, headers, body, alreadyAbsent: false };
};

/** Unknown outcomes stay quarantined. An absent PUT is not evidence it cannot arrive later. */
export const workerOperationCompleted = async (
  operation: WorkerOperation,
  authorization: string,
): Promise<boolean> => {
  if (!operation.tag && !operation.existed) return false;
  const url = new URL(operation.path);
  const observed = await fetch(`${url.origin}${url.pathname}/settings`, {
    headers: { authorization },
    redirect: "manual",
  });
  if (operation.method === "DELETE") return operation.existed === true && observed.status === 404;
  if (!observed.ok) return false;
  const value = (await observed.json()) as { result?: { tags?: string[] } };
  return !!operation.tag && value.result?.tags?.includes(operation.tag) === true;
};
