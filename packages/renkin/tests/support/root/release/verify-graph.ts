import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { externalNetworkAvailable } from "#test-support/root/full-graph/network-control.ts";
import { execute, type InstalledConsumer } from "./consumer.ts";

export const verifyGraph = async (consumer: InstalledConsumer) => {
  assert.equal(await externalNetworkAvailable(), true, "External TCP positive control failed");
  const env = { ...consumer.env, RENKIN_GRAPH_NETWORK_DENIED: "true" };
  const scenario = [
    "--no-env-file",
    join(consumer.directory, "tests/support/root/full-graph/scenario.ts"),
    join(consumer.directory, "tests/fixtures/full-graph"),
  ];
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    const profile = join(consumer.directory, "loopback-only.sb");
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
  } else if (process.platform === "linux") {
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
      "release-network",
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
  } else throw new Error("Installed release validation supports macOS and Linux only");
  const result = await execute(command, args, {
    cwd: consumer.directory,
    env,
    timeout: 150000,
    maxBuffer: 200000,
  });
  assert.match(result.stdout, /external TCP denied/);
  assert.match(result.stdout, /separate stack isolation/);
  return result.stdout;
};
