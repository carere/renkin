import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/** TCP only: verifies the firewall independently of application fetch instrumentation. */
export const externalNetworkAvailable = () =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: "1.1.1.1", port: 443 });
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(3000, () => done(false));
  });
export const assertIsolated = async () => {
  assert.equal(process.env.CLOUDFLARE_AUTH_USE_KEYRING, "false");
  assert.ok(process.env.XDG_CONFIG_HOME);
  assert.equal(
    Object.keys(process.env).some((key) => /TOKEN|SECRET|API_KEY|PROXY/i.test(key)),
    false,
  );
  assert.equal(await externalNetworkAvailable(), false, "External TCP unexpectedly reachable");
  if (process.platform === "darwin") {
    await assert.rejects(
      stat(join(homedir(), ".wrangler")),
      (error: NodeJS.ErrnoException) =>
        error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOENT",
    );
  } else {
    await assert.rejects(
      stat(join(homedir(), ".wrangler")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  }
  console.info(
    "graph: external TCP denied; provider credentials absent; keyring disabled; legacy profile unavailable",
  );
};
