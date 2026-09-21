import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { cloudSuites } from "../support/root/release/cloud/catalog.ts";
import { prepareInstalledCloud } from "../support/root/release/cloud/prepare.ts";
import { runInstalledCloud } from "../support/root/release/cloud/run.ts";

it("prepares every maintained cloud suite without provider calls or private package imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-cloud-preparation-"));
  try {
    // This fixture validates copying/adaptation only, not release-artifact installation.
    const packageRoot = join(directory, "node_modules/renkin");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "renkin", bin: { renkin: "cli.js" } }),
    );
    for (const app of ["example-spa", "example-ssr", "example-static", "website"])
      await mkdir(join(directory, "apps", app), { recursive: true });
    await prepareInstalledCloud(resolve("../.."), directory);
    const base = join(directory, "packages/renkin/tests");
    expect((await readdir(join(base, "cloud/root"))).sort()).toEqual(
      cloudSuites.map((name) => `${name}.test.ts`).sort(),
    );
    const record = JSON.parse(
      await readFile(join(directory, "release-cloud-manifest.json"), "utf8"),
    );
    for (const item of record.inventory as {
      path: string;
      sourceHash: string;
      installedHash: string;
    }[]) {
      const text = await readFile(join(directory, "packages/renkin", item.path), "utf8");
      expect(text).not.toContain("@renkin/");
      expect(text).not.toContain("src/contexts/root/cli/main.ts");
      expect(item.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(item.installedHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const authorization = await readFile(
      join(base, "cloud/root/state-authorization.test.ts"),
      "utf8",
    );
    expect(authorization).toContain('from "renkin"');
    expect(authorization).toContain("expect(observer.count()).toBeGreaterThan(0)");
    expect(authorization).toContain("expect(denied.status).toBe(401)");
    expect(record.publicEquivalentForAdapterSuites).toEqual([
      "packages/cloudflare/tests/cloud/root/services/state/state-authorization.test.ts",
    ]);
    const assertions = await readFile(
      join(base, "support/root/cloud-full-graph/assertions.ts"),
      "utf8",
    );
    expect(assertions).toContain('toEqual({ attempts: "1", accepted: "yes" })');
    expect(assertions).toContain("/schedules");
    const site = await readFile(join(base, "cloud/root/protected-site.test.ts"), "utf8");
    expect(site.includes("deploys, protects, observes, updates and removes")).toBe(true);
    expect(site).toContain("receiptOnly");
    expect(
      await readFile(join(base, "support/root/cloud-full-graph/bounded-fetch.ts"), "utf8"),
    ).toContain("new Request(input, init)");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects execution without an explicitly supplied scope before reading a consumer or spawning", async () => {
  await expect(runInstalledCloud("/missing-installed-consumer", {})).rejects.toThrow(
    "explicit current",
  );
});
