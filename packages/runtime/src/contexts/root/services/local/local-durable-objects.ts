import type { WorkerOptions } from "miniflare";
import type { Requirements } from "../../models/binding.ts";

export interface LocalDurableObject {
  readonly worker: string;
  readonly className: string;
  readonly namespace: string;
}
export const localDurableObjects = (
  requirements: Requirements,
  objects: Readonly<Record<string, LocalDurableObject>>,
): Pick<WorkerOptions, "durableObjects"> => {
  const durableObjects: Record<
    string,
    { className: string; scriptName: string; useSQLite: true; unsafeUniqueKey: string }
  > = {};
  for (const [name, requirement] of Object.entries(requirements)) {
    if (requirement.type !== "cloudflare.durable-object") continue;
    const object = objects[requirement.id];
    if (!object) throw new Error(`Durable Object ${requirement.id} is not declared in the stack.`);
    durableObjects[name] = {
      className: object.className,
      scriptName: object.worker,
      useSQLite: true,
      unsafeUniqueKey: object.namespace,
    };
  }
  return { durableObjects };
};
