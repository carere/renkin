import type { NativeWorkflow } from "./workflow-client.ts";

interface JournalBinding {
  fetch(request: Request): Promise<Response>;
}
/** Only local graph bindings install this registry. Cloud bindings remain untouched. */
export const localWorkflow = <Params>(
  native: NativeWorkflow<Params>,
  binding: string,
  env: Record<string, unknown>,
): NativeWorkflow<Params> => {
  const journal = env.__RENKIN_WORKFLOW_JOURNAL as JournalBinding | undefined;
  if (!journal) return native;
  const names = env.__RENKIN_WORKFLOW_NAMES as Record<string, string> | undefined;
  const name = names?.[binding];
  if (!name) throw new Error("Local Workflow binding has no recovery identity.");
  const record = async (options: Parameters<NativeWorkflow<Params>["create"]>[0]) => {
    const prepared = { ...options, id: options?.id ?? crypto.randomUUID() };
    const response = await journal.fetch(
      new Request("http://renkin-workflow-journal/record", {
        method: "POST",
        body: JSON.stringify({ name, id: prepared.id }),
      }),
    );
    if (!response.ok) throw new Error("Local Workflow recovery checkpoint failed.");
    return prepared;
  };
  return new Proxy(native, {
    get(target, property) {
      if (property === "create")
        return async (options: Parameters<typeof native.create>[0]) =>
          native.create(await record(options));
      if (property === "createBatch")
        return async (options: Parameters<typeof native.createBatch>[0]) =>
          native.createBatch(await Promise.all(options.map(record)));
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
};
