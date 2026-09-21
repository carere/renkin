import { defineStack as stackDefinition, output as stackOutput } from "@renkin/core/models/stack";
import {
  deploy as apply,
  planDeployment as preview,
  removeEnvironment as remove,
} from "#src/contexts/root/services/deployment/deployment.ts";
import { development as local } from "#src/contexts/root/services/development/development.ts";
import {
  listEnvironments as list,
  readOutputs as outputs,
} from "#src/contexts/root/services/read-environment.ts";

export const defineStack = stackDefinition;
export const output = stackOutput;
export const deploy = apply;
export const removeEnvironment = remove;
export const development = local;
export const listEnvironments = list;
export const readOutputs = outputs;

export const planDeployment = preview;

import type {
  WorkerBuildResult as BuildResult,
  AssetRouting as Routing,
} from "@renkin/runtime/models/build-result";
export type WorkerBuildResult = BuildResult;
export type AssetRouting = Routing;

import {
  inspectRecovery as inspect,
  reconcileOperation as reconcile,
} from "#src/contexts/root/services/recovery.ts";
export const inspectRecovery = inspect;
export const reconcileOperation = reconcile;

import { buildCommand as command } from "@renkin/runtime/services/build-command/build-command";
import { withBuildCommand as external } from "#src/contexts/root/services/build/with-build-command.ts";
export const buildCommand = command;
export const withBuildCommand = external;

import type { BuildCommandOptions as CommandOptions } from "@renkin/runtime/models/build-command";
import type { BuildReuseOptions as ReuseOptions } from "@renkin/runtime/models/build-reuse";
export type BuildCommandOptions = CommandOptions;
export type BuildReuseOptions = ReuseOptions;
