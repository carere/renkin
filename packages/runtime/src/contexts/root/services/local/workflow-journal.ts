import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WorkflowRecoveryRecord {
  readonly name: string;
  readonly id: string;
  readonly recovering: boolean;
}
const decode = (value: unknown): WorkflowRecoveryRecord[] => {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        typeof item.id === "string" &&
        typeof item.recovering === "boolean",
    )
  )
    throw new Error("Invalid local Workflow recovery journal.");
  return value;
};
export const workflowJournal = async (persist: string, names: readonly string[]) => {
  const path = join(persist, "workflow-recovery.json");
  const records: WorkflowRecoveryRecord[] = await readFile(path, "utf8")
    .then((source) => decode(JSON.parse(source)))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  let pending = Promise.resolve();
  const write = (record: WorkflowRecoveryRecord) => {
    pending = pending.then(async () => {
      const index = records.findIndex((item) => item.name === record.name && item.id === record.id);
      if (index < 0) records.push(record);
      else records[index] = record;
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
      await rename(temporary, path);
    });
    return pending;
  };
  return {
    records: () => records.filter((record) => names.includes(record.name)),
    write,
    settled: () => pending,
    fetch: async (request: Request): Promise<Response> => {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/record")
        return new Response(null, { status: 404 });
      const value: unknown = await request.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("name" in value) ||
        !("id" in value) ||
        typeof value.name !== "string" ||
        !names.includes(value.name) ||
        typeof value.id !== "string" ||
        value.id.length > 100
      )
        return new Response(null, { status: 400 });
      const previous = records.find((item) => item.name === value.name && item.id === value.id);
      await write({ name: value.name, id: value.id, recovering: previous?.recovering ?? false });
      return new Response(null, { status: 204 });
    },
  };
};
export type WorkflowJournal = Awaited<ReturnType<typeof workflowJournal>>;
