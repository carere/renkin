import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  defineStack,
  deploy,
  listEnvironments,
  output,
  readOutputs,
  removeEnvironment,
} from "renkin";
import { worker } from "renkin/cloudflare";

const scope = () => {
  const prefix = process.env.RENKIN_CLOUDFLARE_TEST_PREFIX;
  const expiry = Date.parse(process.env.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "");
  if (
    process.env.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    !prefix ||
    !Number.isFinite(expiry) ||
    Date.now() >= expiry ||
    process.env.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true"
  ) {
    throw new Error(
      "Temporary Cloudflare tests require current explicit authorization and a resource prefix.",
    );
  }
  return { prefix, stateScriptName: `${prefix}-state-v2` };
};

const assertHttp = async (url: string, expected: string): Promise<void> => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(url).catch(() => undefined);
    if (response?.ok && (await response.text()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Worker did not serve the expected response before the propagation deadline.");
};

const assertIndependentOutputs = async (
  directory: string,
  stackName: string,
  stateScriptName: string,
): Promise<void> => {
  await writeFile(
    join(directory, "renkin.ts"),
    'throw new Error("Do not evaluate infrastructure to read state");',
  );
  const cli = new URL("../../../src/contexts/root/cli/main.ts", import.meta.url).pathname;
  const child = await promisify(execFile)(
    process.versions.bun ? process.execPath : "bun",
    [cli, "outputs", "--stack", stackName, "--env", "smoke", "--state-worker", stateScriptName],
    { cwd: directory },
  );
  expect(JSON.parse(child.stdout)).toMatchObject({ version: "one", password: "[REDACTED]" });
  expect(child.stderr).toBe("");
};

it.effect("deploys, updates, reads shared outputs and removes a temporary Worker", () =>
  Effect.promise(async () => {
    const { prefix, stateScriptName } = scope();
    const directory = await mkdtemp(join(tmpdir(), "renkin-cloud-"));
    const entry = join(directory, "worker.ts");
    const stackName = `${prefix}-${randomUUID().slice(0, 8)}`;
    const options = { environment: "smoke", yes: true, cloudflare: { stateScriptName } };
    console.info(`Cloud test ownership: ${stackName}/smoke; retained backend: ${stateScriptName}`);
    const stack = defineStack({
      name: stackName,
      resources: [worker("api", { entry, compatibilityDate: "2026-09-21" })],
      outputs: { version: output("one"), password: output("temporary-secret", { secret: true }) },
    });
    const cleanup = async () => {
      try {
        await Effect.runPromise(removeEnvironment(stackName, options));
      } catch {
        throw new Error(
          `Cloud cleanup failed. Inspect owned environment ${stackName}/smoke; do not delete resources by name alone.`,
        );
      }
    };
    let completed = false;
    try {
      await writeFile(entry, 'export default { fetch() { return new Response("one") } }');
      const first = await Effect.runPromise(deploy(stack, options));
      const id = first.resources.api?.physicalId;
      expect(id?.startsWith(prefix)).toBe(true);
      const firstOutput = first.resources.api?.outputs;
      if (
        !firstOutput ||
        typeof firstOutput !== "object" ||
        !("url" in firstOutput) ||
        typeof firstOutput.url !== "string"
      )
        throw new Error("Worker URL missing.");
      await assertHttp(firstOutput.url, "one");
      expect(
        await Effect.runPromise(listEnvironments(stackName, { cloudflare: options.cloudflare })),
      ).toContain("smoke");
      expect(
        await Effect.runPromise(
          readOutputs(stackName, "smoke", { cloudflare: options.cloudflare }),
        ),
      ).toMatchObject({ version: "one", password: "[REDACTED]" });
      await writeFile(entry, 'export default { fetch() { return new Response("two") } }');
      const updated = await Effect.runPromise(deploy(stack, options));
      expect(updated.resources.api?.physicalId).toBe(id);
      await assertHttp(firstOutput.url, "two");
      await assertIndependentOutputs(directory, stackName, stateScriptName);
      completed = true;
    } finally {
      try {
        await cleanup();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    expect(completed).toBe(true);
    expect(
      await Effect.runPromise(readOutputs(stackName, "smoke", { cloudflare: options.cloudflare })),
    ).toBeUndefined();
    expect(
      await Effect.runPromise(listEnvironments(stackName, { cloudflare: options.cloudflare })),
    ).not.toContain("smoke");
  }),
);
