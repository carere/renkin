import { setTimeout as sleep } from "node:timers/promises";
import type { Miniflare, WorkerOptions } from "miniflare";
import { LocalWorkflowRecoveryError } from "../../models/local-workflow-recovery-error.ts";
import type { NativeWorkflow } from "../../models/workflow-client.ts";
import type { LocalWorkflow } from "./local-background.ts";
import type { WorkflowJournal, WorkflowRecoveryRecord } from "./workflow-journal.ts";

export const workflowRecoveryWorker = (
  workflows: Readonly<Record<string, LocalWorkflow>>,
): WorkerOptions => ({
  name: "__renkin_workflows",
  script: "export default {fetch(){return new Response(null,{status:404})}}",
  modules: true,
  compatibilityDate: "2026-07-30",
  workflows: { ...workflows },
});
const terminal = (status: string) => ["complete", "errored", "terminated"].includes(status);
const pauseSettled = async (instance: Awaited<ReturnType<NativeWorkflow["get"]>>) => {
  const deadline = Date.now() + 5000;
  while (true) {
    const { status } = await instance.status();
    if (status === "paused" || terminal(status)) return status;
    if (Date.now() > deadline)
      throw new LocalWorkflowRecoveryError("Local Workflow pause did not settle during recovery.");
    await sleep(10);
  }
};
const wake = async (
  native: NativeWorkflow,
  record: WorkflowRecoveryRecord,
  journal: WorkflowJournal,
) => {
  let instance: Awaited<ReturnType<NativeWorkflow["get"]>>;
  try {
    instance = await native.get(record.id);
  } catch (error) {
    // A journal intent can precede an interrupted native create; it is not an instance to restart.
    if (error instanceof Error && error.message.includes("instance.not_found")) return;
    throw error;
  }
  const current = await instance.status();
  if (terminal(current.status)) return;
  if ((current.status === "paused" || current.status === "waitingForPause") && !record.recovering)
    return;
  if (current.status === "queued" || current.status === "unknown")
    throw new LocalWorkflowRecoveryError(
      `Local Workflow ${record.id} cannot be recovered from ${current.status}; inspect it before retrying.`,
    );
  await journal.write({ ...record, recovering: true });
  if (current.status !== "paused") await instance.pause();
  if ((await pauseSettled(instance)) === "paused") await instance.resume();
  await journal.write({ ...record, recovering: false });
};
/** Wakes the installed native emulator while preserving its original event and cached steps. */
export const recoverWorkflows = async (
  runtime: Miniflare,
  workflows: Readonly<Record<string, LocalWorkflow>>,
  journal: WorkflowJournal,
) => {
  if (!Object.keys(workflows).length) return;
  const bindings = await runtime.getBindings("__renkin_workflows");
  for (const record of journal.records()) {
    const logical = Object.entries(workflows).find(
      ([, definition]) => definition.name === record.name,
    )?.[0];
    if (logical) await wake(bindings[logical] as NativeWorkflow, record, journal);
  }
};
