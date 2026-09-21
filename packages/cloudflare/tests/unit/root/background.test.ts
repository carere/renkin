import { expect, it } from "@effect/vitest";
import { queue } from "../../../src/contexts/root/models/queue.ts";
import { worker } from "../../../src/contexts/root/models/worker.ts";
import { workflow } from "../../../src/contexts/root/models/workflow.ts";
import { prepareBackgroundResources } from "../../../src/contexts/root/services/worker/prepare-background.ts";

it("preflights invalid background policies and derives Workflow owner protection before deployment", () => {
  const jobs = queue("Jobs");
  const owner = worker("App", { entry: "app.ts", compatibilityDate: "2026-07-30" });
  const flow = workflow("Flow", { worker: "App", className: "Job" });
  const prepared = prepareBackgroundResources([owner, flow]);
  expect(prepared[0]?.protection).toEqual({ data: true, allowDelete: false });
  expect(() => prepareBackgroundResources([flow])).toThrow("declared Worker");
  expect(() => prepareBackgroundResources([queue("Jobs", { deliveryDelay: 86401 })])).toThrow(
    "deliveryDelay",
  );
  expect(() => prepareBackgroundResources([queue("Jobs", { messageRetentionPeriod: 1 })])).toThrow(
    "messageRetentionPeriod",
  );
  for (const consumer of [
    { queue: jobs, maxRetries: 101 },
    { queue: jobs, retryDelay: -1 },
    { queue: jobs, deadLetterQueue: jobs },
  ]) {
    const app = worker("App", {
      entry: "app.ts",
      compatibilityDate: "2026-07-30",
      consumers: [consumer],
    });
    expect(() => prepareBackgroundResources([jobs, app])).toThrow();
  }
});
