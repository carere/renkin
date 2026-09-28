import { expect, it } from "@effect/vitest";
import {
  bumpArguments,
  compareVersions,
  parseVersion,
} from "#src/contexts/root/services/release/version.ts";

it("orders prerelease and stable versions according to SemVer", () => {
  const sequence = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.1.0",
    "2.0.0",
  ];
  for (let i = 1; i < sequence.length; i++)
    expect(compareVersions(sequence[i] ?? "", sequence[i - 1] ?? "")).toBe(1);
  expect(compareVersions("1.0.0+build.2", "1.0.0+build.1")).toBe(0);
});
it("keeps automatic prerelease bumps within their base and stage", () => {
  for (const stage of ["alpha", "beta", "rc"])
    expect(bumpArguments(`0.1.0-${stage}.9`)).toEqual([
      "--version",
      "0.1.0",
      "--pre",
      `${stage}.*`,
    ]);
  expect(bumpArguments("0.1.0")).toEqual(["--auto"]);
  expect(bumpArguments("0.1.0-rc.3", "0.1.0")).toEqual(["--version", "0.1.0"]);
});
it("rejects invalid, equal and earlier explicit versions before running commands", () => {
  for (const version of [
    "v1.0.0",
    "01.0.0",
    "1.0",
    "1.0.0-rc.01",
    "1.0.0\n",
    "--auto",
    "1.0.0;echo bad",
  ])
    expect(() => parseVersion(version)).toThrow("Invalid");
  for (const version of ["1.0.0", "1.0.0+build", "1.0.0-rc.1", "0.9.9"])
    expect(() => bumpArguments("1.0.0", version)).toThrow("newer");
});
