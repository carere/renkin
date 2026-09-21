import {
  type WorkflowEvent as Event,
  defineWorkflow as implementation,
} from "@renkin/runtime/models/workflow-implementation";
export const defineWorkflow = implementation;

import type { WorkflowStepContext as StepContext } from "@renkin/runtime/models/workflow-steps";
export type WorkflowEvent<Params> = Event<Params>;
export type WorkflowStepContext = StepContext;
