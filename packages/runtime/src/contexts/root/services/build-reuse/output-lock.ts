import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const queues = new Map<string, Promise<unknown>>();
export const buildLeaseVariable = "RENKIN_BUILD_OUTPUT_LEASE";
interface Lease {
  readonly root: string;
  readonly path: string;
  readonly token: string;
  readonly pid: number;
}

const acquire = async (root: string): Promise<Lease> => {
  const directory = resolve(root, ".renkin/build");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let path = resolve(directory, "output.lock");
  const inherited = process.env[buildLeaseVariable];
  if (inherited) {
    const parent = JSON.parse(inherited) as Lease;
    if (parent.root === root) {
      if (
        !parent.path.startsWith(`${directory}/output.lock`) ||
        JSON.parse(await readFile(parent.path, "utf8")).token !== parent.token
      )
        throw new Error("The parent build output lease is no longer valid.");
      // The parent waits for this child. Siblings still contend for one child lock.
      path = `${parent.path}.child`;
    }
  }
  const lease = { root, path, token: randomUUID(), pid: process.pid };
  try {
    await writeFile(path, JSON.stringify(lease), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(
        "Build output is busy. Inspect the recorded process before removing a stale output.lock; live compiler locks are never stolen.",
      );
    throw error;
  }
  return lease;
};

/** Child commands receive a verified handoff, not a blanket lock bypass. */
export const withBuildOutput = <T>(
  root: string,
  run: (environment: Readonly<Record<string, string>>) => Promise<T>,
): Promise<T> => {
  const previous = queues.get(root) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined)
    .then(async () => {
      const lease = await acquire(root);
      try {
        return await run({ [buildLeaseVariable]: JSON.stringify(lease) });
      } finally {
        if (JSON.parse(await readFile(lease.path, "utf8")).token === lease.token)
          await rm(lease.path);
      }
    });
  queues.set(root, result);
  void result
    .finally(() => {
      if (queues.get(root) === result) queues.delete(root);
    })
    .catch(() => undefined);
  return result;
};
