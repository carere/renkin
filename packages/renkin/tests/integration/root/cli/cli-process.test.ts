import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "@effect/vitest";
import {
  readCliResponse,
  startCli,
  waitForCliUrl,
} from "#test-support/root/services/cli-process/cli-process.ts";

it("cleans a child that closed before startup or cleanup observed it", async () => {
  const cli = startCli(["--no-env-file", "-e", "process.exit(17)"], process.cwd());
  await cli.closed;
  await expect(waitForCliUrl(cli, 100)).rejects.toThrow("CLI startup: process exited");
  await cli.stop(50, 500);
  expect(cli.child.exitCode).toBe(17);
}, 3_000);

it("forces termination when an owned child ignores graceful shutdown", async () => {
  const cli = startCli(
    [
      "--no-env-file",
      "-e",
      'process.on("SIGTERM",()=>{}); console.error("http://127.0.0.1:1/"); setInterval(()=>{},1000);',
    ],
    process.cwd(),
  );
  try {
    await waitForCliUrl(cli, 1_000);
    await cli.stop(50, 1_000);
    expect(cli.child.signalCode).toBe("SIGKILL");
  } finally {
    await cli.stop();
  }
}, 3_000);

it("bounds a response body that never completes", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.write("partial");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  try {
    await expect(
      readCliResponse(`http://127.0.0.1:${address.port}`, "initial request", 100),
    ).rejects.toThrow("CLI initial request: response failed within 100ms");
  } finally {
    const closed = once(server, "close");
    server.closeAllConnections();
    server.close();
    await closed;
  }
}, 3_000);
