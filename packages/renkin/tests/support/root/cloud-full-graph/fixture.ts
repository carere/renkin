import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { deploy, listEnvironments, removeEnvironment } from "@carere/renkin";
import type { EnvironmentState } from "@renkin/core/models/state";
import { Effect } from "effect";
import { removeGraphBackend } from "./backend.ts";
import { boundRequests } from "./bounded-fetch.ts";
import { cloudGraph } from "./cloud-stack.ts";

const authorizedGraphScope = () => {
  const env = process.env;
  if (
    env.RENKIN_CLOUDFLARE_TEST_PREFIX !== "renkin-test" ||
    env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_ENABLED !== "true" ||
    env.RENKIN_CLOUDFLARE_EMAIL_ENABLED !== "true" ||
    !(Number(env.RENKIN_CLOUDFLARE_EMAIL_MAX_MESSAGES) >= 2) ||
    !(
      Number(env.RENKIN_CLOUDFLARE_MAX_SPEND_USD) > 0 &&
      Number(env.RENKIN_CLOUDFLARE_MAX_SPEND_USD) <= 5
    ) ||
    !(Date.parse(env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "") > Date.now()) ||
    !env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN ||
    !env.CLOUDFLARE_ACCOUNT_ID ||
    !env.CLOUDFLARE_API_TOKEN ||
    !env.RENKIN_CLOUDFLARE_EMAIL_FROM ||
    !env.RENKIN_CLOUDFLARE_EMAIL_TO
  )
    throw new Error(
      "Full-graph cloud validation requires current scoped resource, token and email authorization.",
    );
  return {
    from: env.RENKIN_CLOUDFLARE_EMAIL_FROM,
    to: env.RENKIN_CLOUDFLARE_EMAIL_TO,
    expiresAt: new Date(env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "")
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
  };
};
export const createCloudGraphFixture = async () => {
  authorizedGraphScope();
  const name = `renkin-test-graph-${randomUUID().slice(0, 8)}`;
  const isolatedState = process.env.RENKIN_CLOUDFLARE_GRAPH_ISOLATED_STATE === "true";
  const directory = resolve(".renkin");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ledger = resolve(directory, "cloud-full-graph-ledger.jsonl");
  let compilations = 0;
  const stack = (cron = "0 0 1 1 *") =>
    cloudGraph(
      name,
      cron,
      () => {
        compilations++;
      },
      authorizedGraphScope(),
    );
  const cloudflare = {
    stateScriptName: isolatedState ? `${name}-state` : "renkin-test-state-v2",
    tokenManagementApiToken: process.env.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN ?? "",
  };
  const options = {
    environment: "full-graph",
    yes: true,
    cloudflare,
    progress: ({ id, kind }: { id: string; kind: string }) =>
      console.info(`Cloud graph ${kind}: ${id}`),
  };
  const record = async (event: string, state?: EnvironmentState) => {
    const resources = state
      ? Object.values(state.resources).map((resource) => ({
          id: resource.definition.id,
          type: resource.definition.type,
          physicalId: resource.physicalId,
        }))
      : undefined;
    await appendFile(
      ledger,
      `${JSON.stringify({ at: new Date().toISOString(), name, environment: options.environment, stateScriptName: cloudflare.stateScriptName, event, resources })}\n`,
      { mode: 0o600 },
    );
  };
  await record("allocated-scope");
  const restoreFetch = boundRequests();
  return {
    name,
    options,
    stack,
    compilations: () => compilations,
    apply(cron?: string) {
      return Effect.gen(function* () {
        authorizedGraphScope();
        const state = yield* deploy(stack(cron), options);
        yield* Effect.tryPromise(() => record("deployed", state));
        return state;
      });
    },
    async close() {
      try {
        authorizedGraphScope();
        await Effect.runPromise(removeEnvironment(name, options));
        if ((await Effect.runPromise(listEnvironments(name, { cloudflare }))).length)
          throw new Error("Cloud graph environment was not removed.");
        await record("cleanup-complete");
        console.info(`Cloud graph exact cleanup complete: ${name}/${options.environment}`);
        if (isolatedState) {
          await removeGraphBackend(name);
          await record("isolated-backend-cleanup-complete");
        }
      } finally {
        restoreFetch();
      }
    },
  };
};
