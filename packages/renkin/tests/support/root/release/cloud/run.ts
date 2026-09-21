import { spawn } from "node:child_process";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type CloudSuite, cloudSuites } from "./catalog.ts";

export const scopeKeys = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "RENKIN_CLOUDFLARE_TESTS_AUTHORIZED",
  "RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED",
  "RENKIN_CLOUDFLARE_TEST_PREFIX",
  "RENKIN_CLOUDFLARE_TEST_DOMAIN",
  "RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL",
  "RENKIN_CLOUDFLARE_MAX_SPEND_USD",
  "RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_ENABLED",
  "RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_TOKEN",
  "RENKIN_CLOUDFLARE_EMAIL_ENABLED",
  "RENKIN_CLOUDFLARE_EMAIL_FROM",
  "RENKIN_CLOUDFLARE_EMAIL_TO",
  "RENKIN_CLOUDFLARE_EMAIL_MAX_MESSAGES",
] as const;

const scope = (environment: Readonly<Record<string, string>>) => {
  if (
    scopeKeys.some((key) => !environment[key]) ||
    environment.RENKIN_CLOUDFLARE_TESTS_AUTHORIZED !== "true" ||
    environment.RENKIN_CLOUDFLARE_PRODUCTS_CONFIRMED !== "true" ||
    environment.RENKIN_CLOUDFLARE_TEST_PREFIX !== "renkin-test" ||
    environment.RENKIN_CLOUDFLARE_TOKEN_MANAGEMENT_ENABLED !== "true" ||
    environment.RENKIN_CLOUDFLARE_EMAIL_ENABLED !== "true" ||
    !(Number(environment.RENKIN_CLOUDFLARE_EMAIL_MAX_MESSAGES) >= 2) ||
    !(
      Number(environment.RENKIN_CLOUDFLARE_MAX_SPEND_USD) > 0 &&
      Number(environment.RENKIN_CLOUDFLARE_MAX_SPEND_USD) <= 5
    ) ||
    !(Date.parse(environment.RENKIN_CLOUDFLARE_AUTHORIZED_UNTIL ?? "") > Date.now())
  )
    throw new Error(
      "Installed cloud run requires an explicit current resource/domain/token/email scope.",
    );
  return Object.fromEntries(scopeKeys.map((key) => [key, environment[key]]));
};

/** Executes only the already-prepared consumer. Caller owns approval, shared budget and cleanup audit. */
export const runInstalledCloud = async (
  consumerDirectory: string,
  scopeEnvironment: Readonly<Record<string, string>>,
  suites: readonly CloudSuite[] = cloudSuites,
  testNamePattern?: string,
  graphReuseOnly = false,
): Promise<void> => {
  const authorized = scope(scopeEnvironment);
  if (!process.versions.bun) throw new Error("Installed cloud harness requires Bun.");
  if (
    !suites.length ||
    suites.some((name) => !cloudSuites.includes(name)) ||
    new Set(suites).size !== suites.length
  )
    throw new Error("Select distinct maintained cloud suites.");
  const directory = await realpath(consumerDirectory);
  const manifest = JSON.parse(
    await readFile(join(directory, "release-cloud-manifest.json"), "utf8"),
  );
  if (manifest.version !== 1 || JSON.stringify(manifest.suites) !== JSON.stringify(cloudSuites))
    throw new Error("Prepare this installed cloud consumer before execution.");
  const configHome = join(directory, ".release-cloud-config");
  await mkdir(configHome, { recursive: true, mode: 0o700 });
  const env = {
    ...authorized,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    HOME: process.env.HOME ?? "",
    TMPDIR: tmpdir(),
    XDG_CONFIG_HOME: configHome,
    CLOUDFLARE_AUTH_USE_KEYRING: "false",
    PROTO_OFFLINE: "true",
    NO_COLOR: "1",
    ...(graphReuseOnly ? { RENKIN_CLOUDFLARE_GRAPH_REUSE_ONLY: "true" } : {}),
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--no-env-file",
        join(directory, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.installed-cloud.config.ts",
        ...suites.map((name) => `tests/cloud/root/${name}.test.ts`),
        ...(testNamePattern ? ["--testNamePattern", testNamePattern] : []),
      ],
      {
        cwd: join(directory, "packages/renkin"),
        env,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Installed cloud suite exited ${code}; inspect exact owned scopes before retrying.`,
            ),
          ),
    );
  });
};
