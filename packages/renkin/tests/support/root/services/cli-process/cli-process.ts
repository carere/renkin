import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const settledWithin = async (closed: Promise<unknown>, milliseconds: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Observe close/error immediately, including children that exit before cleanup starts. */
export const startCli = (args: readonly string[], cwd: string) => {
  const child = spawn(process.versions.bun ? process.execPath : "bun", [...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let failure: Error | undefined;
  let ended = false;
  child.stdout.resume();
  child.stderr.on("data", (chunk) => {
    log = (log + String(chunk)).slice(-16_000);
  });
  child.on("error", (error) => {
    failure = error;
  });
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => {
      ended = true;
      resolve();
    });
  });
  let stopping: Promise<void> | undefined;
  const stop = (grace = 3_000, force = 2_000) =>
    (stopping ??= (async () => {
      if (ended) return;
      child.kill("SIGTERM");
      if (await settledWithin(closed, grace)) return;
      // The detached POSIX process group contains only this test's CLI and children.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      if (!(await settledWithin(closed, force)))
        throw new Error("CLI cleanup: close not observed after SIGKILL.");
    })());
  const assertRunning = (phase: string) => {
    if (failure || ended || child.exitCode !== null || child.signalCode !== null)
      throw new Error(`CLI ${phase}: process exited before completion. ${failure?.message ?? log}`);
  };
  return { child, closed, stop, assertRunning, output: () => log };
};

export const waitForCliUrl = async (cli: ReturnType<typeof startCli>, milliseconds: number) => {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    cli.assertRunning("startup");
    const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(cli.output())?.[0];
    if (url) return url;
    await delay(100);
  }
  throw new Error(`CLI startup: no URL within ${milliseconds}ms. ${cli.output()}`);
};

export const readCliResponse = async (url: string, phase: string, milliseconds: number) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(milliseconds) });
    return await response.text();
  } catch (cause) {
    throw new Error(`CLI ${phase}: response failed within ${milliseconds}ms.`, { cause });
  }
};

export const waitForCliReload = async (
  cli: ReturnType<typeof startCli>,
  url: string,
  expected: string,
  milliseconds: number,
) => {
  const deadline = Date.now() + milliseconds;
  let last: unknown;
  while (Date.now() < deadline) {
    cli.assertRunning("reload");
    try {
      const body = await readCliResponse(
        url,
        "reload",
        Math.min(1_000, Math.max(1, deadline - Date.now())),
      );
      if (body === expected) return body;
      last = `received ${JSON.stringify(body)}`;
    } catch (error) {
      last = error;
    }
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(
    `CLI reload: did not observe ${JSON.stringify(expected)} within ${milliseconds}ms; ${String(last)}`,
  );
};
