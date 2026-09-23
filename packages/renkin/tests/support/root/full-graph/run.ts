import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { externalNetworkAvailable } from "./network-control.ts";

const isolated = process.argv.includes("--network-denied");
if (isolated)
  assert.equal(
    await externalNetworkAvailable(),
    true,
    "External TCP positive control must succeed before denying it",
  );
const directory = await mkdtemp(join(tmpdir(), "renkin-full-graph-"));
const fixture = join(directory, "consumer");
const source = fileURLToPath(new URL("../../../fixtures/full-graph", import.meta.url));
const dependencyRoot = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
const publicPackage = fileURLToPath(new URL("../../../..", import.meta.url));
try {
  await cp(source, fixture, {
    recursive: true,
    filter: (path) =>
      !/(?:node_modules|\.tanstack|\.renkin|routeTree\.gen\.ts|\.env(?:\.|$)|\.dev\.vars(?:\.|$))/.test(
        path,
      ),
  });
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      imports: { "#test-fixtures/full-graph/*": "./*" },
    }),
  );
  await mkdir(join(fixture, "node_modules"));
  for (const dependency of await readdir(dependencyRoot)) {
    if (dependency.startsWith(".")) continue;
    await symlink(join(dependencyRoot, dependency), join(fixture, "node_modules", dependency));
  }
  await mkdir(join(fixture, "node_modules/@carere"));
  await symlink(publicPackage, join(fixture, "node_modules/@carere/renkin"));
  await mkdir(join(directory, "config"));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: tmpdir(),
    XDG_CONFIG_HOME: join(directory, "config"),
    CLOUDFLARE_AUTH_USE_KEYRING: "false",
    RENKIN_GRAPH_POLLING: "true",
    NO_COLOR: "1",
    RENKIN_GRAPH_NETWORK_DENIED: String(isolated),
  };
  const scenario = [
    "--no-env-file",
    fileURLToPath(new URL("./scenario.ts", import.meta.url)),
    fixture,
  ];
  let command = process.execPath;
  let args = scenario;
  if (isolated && process.platform === "darwin") {
    const profile = join(directory, "loopback-only.sb");
    await writeFile(
      profile,
      `(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
(deny file-read* (subpath ${JSON.stringify(join(homedir(), ".wrangler"))}))
`,
    );
    command = "/usr/bin/sandbox-exec";
    args = ["-f", profile, process.execPath, ...scenario];
  } else if (isolated && process.platform === "linux") {
    // A fresh CI user has no legacy profile; fail if this assumption is false.
    await assert.rejects(
      stat(join(homedir(), ".wrangler")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    assert.notEqual(uid, undefined);
    assert.notEqual(gid, undefined);
    command = "sudo";
    args = [
      "-n",
      "unshare",
      "--net",
      "--",
      "/bin/sh",
      "-c",
      'ip link set lo up && exec "$@"',
      "graph-network",
      "/usr/bin/setpriv",
      "--reuid",
      String(uid),
      "--regid",
      String(gid),
      "--clear-groups",
      "/usr/bin/env",
      "-i",
      ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
      process.execPath,
      ...scenario,
    ];
  } else if (isolated)
    throw new Error(
      "Network-denied graph validation requires macOS sandbox-exec or Linux sudo/unshare",
    );
  const { stdout, stderr } = await promisify(execFile)(command, args, {
    cwd: fixture,
    env,
    timeout: 150000,
    maxBuffer: 200000,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await rm(directory, { recursive: true, force: true });
}
