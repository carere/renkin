#!/usr/bin/env bun
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type { Stack } from "@renkin/core/models/stack";
import { Effect } from "effect";
import {
  deploy,
  development,
  inspectRecovery,
  listEnvironments,
  planDeployment,
  readOutputs,
  reconcileOperation,
  removeEnvironment,
} from "../api.ts";
import { routeCliOutput } from "./output.ts";

const writeOutput = routeCliOutput();

const usage =
  "Usage: renkin dev|plan|deploy [--file renkin.ts] [--env name] [--yes] [--force]; renkin list|outputs|remove|inspect|reconcile --stack name [--env name]. Use --local only with list or outputs. Scoped R2 tokens require --token-management-token-env VARIABLE for deploy/remove.";
class CommandError extends Error {
  readonly name = "CommandError";
}
const args = process.argv.slice(2);
const command = args.shift();
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback?: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new CommandError(`--${name} requires a value.`);
  return value;
};
const required = (name: string): string => {
  const value = option(name);
  if (!value) throw new CommandError(`--${name} is required.`);
  return value;
};
const tokenManagement = (): { tokenManagementApiToken?: string } => {
  const name = option("token-management-token-env");
  if (!name) return {};
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !process.env[name])
    throw new CommandError(
      "--token-management-token-env must name a nonempty credential environment variable.",
    );
  return { tokenManagementApiToken: process.env[name] };
};
const confirm = async (): Promise<boolean> => {
  if (!process.stdin.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^(y|yes)$/i.test(await terminal.question("Apply these changes? [y/N] "));
  } finally {
    terminal.close();
  }
};
const loadStack = async (): Promise<Stack> => {
  const module = await import(
    pathToFileURL(resolve(option("file", "renkin.ts") ?? "renkin.ts")).href
  );
  if (!module.default || typeof module.default !== "object")
    throw new Error("Infrastructure file must default-export a stack.");
  return module.default as Stack;
};
const runDevelopment = async (): Promise<void> => {
  const stack = await loadStack();
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* development(stack, {
          environment: option("env", "local") ?? "local",
          directory: option("state-dir", ".renkin") ?? ".renkin",
          progress: (message) => {
            process.stderr.write(`${message}\n`);
          },
        });
        yield* Effect.never;
      }),
    ),
    { signal: controller.signal },
  ).catch((error: unknown) => {
    if (!controller.signal.aborted) throw error;
  });
};
const runRecovery = async (
  environment: string,
  cloudflare: { stateScriptName?: string },
): Promise<boolean> => {
  if (command === "inspect") {
    writeOutput(
      JSON.stringify(
        await Effect.runPromise(inspectRecovery(required("stack"), environment, cloudflare)),
      ),
    );
    return true;
  }
  if (command !== "reconcile") return false;
  const outcome = required("outcome");
  if (!["completed", "not-applied"].includes(outcome) || !flag("provider-settled"))
    throw new CommandError(
      "Reconciliation requires --outcome completed|not-applied and --provider-settled. Time elapsed or resource absence cannot establish provider settlement.",
    );
  const decision = {
    operationId: required("operation"),
    outcome: outcome as "completed" | "not-applied",
    operator: required("operator"),
    evidence: required("evidence"),
    providerSettled: true as const,
  };
  const stack = required("stack");
  process.stderr.write(`${decision.outcome} ${decision.operationId} in ${stack}/${environment}\n`);
  process.stderr.write(
    "Record the operator's provider settlement assertion and clear this exact quarantine. A delayed provider request cannot be fenced by Renkin.\n",
  );
  if (!flag("yes") && !(await confirm())) throw new CommandError("Reconciliation cancelled.");
  writeOutput(
    JSON.stringify(
      await Effect.runPromise(reconcileOperation(stack, environment, decision, cloudflare)),
    ),
  );
  return true;
};
const run = async (): Promise<void> => {
  if (flag("local") && !["list", "outputs"].includes(command ?? ""))
    throw new Error("--local is supported only by list and outputs; use dev for local execution.");
  const environment = option("env", "dev") ?? "dev";
  const cloudflare = {
    ...tokenManagement(),
    ...(option("state-worker") ? { stateScriptName: option("state-worker") as string } : {}),
  };
  if (await runRecovery(environment, cloudflare)) return;
  const readOptions = {
    cloudflare,
    ...(flag("local")
      ? { localDirectory: resolve(option("state-dir", ".renkin") ?? ".renkin") }
      : {}),
  };
  const options = {
    environment,
    cloudflare,
    yes: flag("yes"),
    force: flag("force"),
    confirm,
    progress: (change: { id: string; kind: string }) => {
      process.stderr.write(`${change.kind} ${change.id}\n`);
    },
  };
  switch (command) {
    case "list":
      writeOutput(
        JSON.stringify(await Effect.runPromise(listEnvironments(required("stack"), readOptions))),
      );
      return;
    case "outputs":
      writeOutput(
        JSON.stringify(
          (await Effect.runPromise(
            readOutputs(required("stack"), environment, {
              ...readOptions,
              revealSecrets: flag("reveal-secrets"),
            }),
          )) ?? null,
        ),
      );
      return;
    case "plan":
      writeOutput(
        JSON.stringify(await Effect.runPromise(planDeployment(await loadStack(), options))),
      );
      return;
    case "deploy": {
      const result = await Effect.runPromise(deploy(await loadStack(), options));
      writeOutput(
        JSON.stringify({
          stack: result.stack,
          environment: result.environment,
          resources: Object.keys(result.resources),
        }),
      );
      return;
    }
    case "remove":
      await Effect.runPromise(removeEnvironment(required("stack"), options));
      writeOutput(JSON.stringify({ removed: environment }));
      return;
    case "dev":
      await runDevelopment();
      return;
    default:
      throw new CommandError(usage);
  }
};

if (command === "help" || command === "--help") writeOutput(usage);
else
  run().catch((error: unknown) => {
    // Never print causes, input values, credentials or arbitrary provider response bodies.
    const message =
      error instanceof Error &&
      ["DeploymentError", "StateError", "CommandError"].includes(error.name)
        ? error.message
        : "Command failed. Check command options, infrastructure file and account configuration.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
