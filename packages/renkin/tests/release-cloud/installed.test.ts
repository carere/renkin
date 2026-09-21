import { it } from "@effect/vitest";
import { type CloudSuite, cloudSuites } from "#test-support/root/release/cloud/catalog.ts";
import { runInstalledCloud, scopeKeys } from "#test-support/root/release/cloud/run.ts";

it("runs maintained cloud acceptance exclusively from an explicitly selected installed consumer", async () => {
  const directory = process.env.RENKIN_INSTALLED_CLOUD_CONSUMER;
  if (!directory)
    throw new Error("Set RENKIN_INSTALLED_CLOUD_CONSUMER to the prepared isolated installation.");
  const names = process.env.RENKIN_INSTALLED_CLOUD_SUITES?.split(",") ?? [...cloudSuites];
  if (names.some((name) => !cloudSuites.includes(name as CloudSuite)))
    throw new Error("Unknown installed cloud suite selection.");
  const environment = Object.fromEntries(scopeKeys.map((key) => [key, process.env[key] ?? ""]));
  await runInstalledCloud(directory, environment, names as CloudSuite[]);
}, 7200000);
