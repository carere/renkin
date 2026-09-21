const replace = (source: string, previous: string, next: string) => {
  if (source.split(previous).length !== 2)
    throw new Error("Installed cloud adaptation no longer matches its maintained source.");
  return source.replace(previous, next);
};
const stateType = "type EnvironmentState = Effect.Success<ReturnType<typeof deploy>>;";
const cron = `export const assertCloudCron = async (state: EnvironmentState, cron: string) => {
  const script = state.resources.Tracking?.physicalId;
  if (!script) throw new Error("Missing Tracking Worker.");
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const response = await fetch(\`https://api.cloudflare.com/client/v4/accounts/\${account}/workers/scripts/\${script}/schedules\`, {
    headers: { authorization: \`Bearer \${process.env.CLOUDFLARE_API_TOKEN}\` },
    signal: AbortSignal.timeout(15000),
  });
  expect(response.status).toBe(200);
  const observed = await response.json() as {success:boolean;result:{schedules:{cron:string}[]}};
  expect(observed.success).toBe(true);
  expect(observed.result.schedules.map((entry) => entry.cron)).toEqual([cron]);
};
`;

export const adaptCloudSource = (path: string, source: string) => {
  if (path.endsWith("cloud/root/worker.test.ts")) {
    source = `import { installedCli } from "../../support/root/installed-cloud-paths.ts";\n${source}`;
    source = replace(
      source,
      'const cli = new URL("../../../src/contexts/root/cli/main.ts", import.meta.url).pathname;',
      "const cli = await installedCli();",
    );
  }
  if (path.endsWith("cloud-r2-fixture.ts"))
    source = replace(
      source,
      'import type { Json } from "@renkin/core/models/stack";',
      "type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };",
    );
  if (path.endsWith("cloud-full-graph/cloud-stack.ts"))
    source = replace(
      source,
      'import type { ResourceDefinition } from "@renkin/core/models/stack";',
      'type ResourceDefinition = ReturnType<typeof defineStack>["resources"][number];',
    );
  if (
    path.endsWith("cloud-full-graph/fixture.ts") ||
    path.endsWith("cloud-full-graph/assertions.ts")
  )
    source = replace(
      source,
      'import type { EnvironmentState } from "@renkin/core/models/state";',
      stateType,
    );
  if (path.endsWith("cloud-full-graph/assertions.ts")) {
    source = replace(
      source,
      'import { createBackgroundClient } from "@renkin/cloudflare-sdk/services/cloudflare-client/background-client";',
      'import type { deploy } from "renkin";',
    );
    const start = source.indexOf("export const assertCloudCron = async");
    if (start < 0 || !source.slice(start).includes("client.getSchedules(script)"))
      throw new Error("Maintained cron assertion changed; review installed adaptation.");
    source = source.slice(0, start) + cron;
  }
  if (/@renkin\/|src\/contexts\/root\/cli\/main\.ts/.test(source))
    throw new Error(`Private implementation reference in installed cloud fixture: ${path}`);
  return source;
};
