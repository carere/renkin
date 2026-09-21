import { defineStack as stackDefinition, output as stackOutput } from "@renkin/core/models/stack";
import {
  deploy as apply,
  planDeployment as preview,
  removeEnvironment as remove,
} from "./services/deployment.ts";
import { development as local } from "./services/development.ts";
import { listEnvironments as list, readOutputs as outputs } from "./services/read-environment.ts";

export const defineStack = stackDefinition;
export const output = stackOutput;
export const deploy = apply;
export const removeEnvironment = remove;
export const development = local;
export const listEnvironments = list;
export const readOutputs = outputs;

export const planDeployment = preview;
