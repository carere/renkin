import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkerBuildResult } from "#src/contexts/root/models/build-result.ts";
import type { BuildProducer, WorkerBuildContext } from "#src/contexts/root/models/build-reuse.ts";
import { captureArtifact, saveArtifact } from "./artifact.ts";
import { canonicalBuildValue, digest, fingerprint } from "./fingerprint.ts";
import { withBuildOutput } from "./output-lock.ts";

interface Receipt {
  readonly schema: 1;
  readonly input: string;
  readonly original: WorkerBuildResult;
  readonly snapshot: WorkerBuildResult;
  readonly hash: string;
  readonly controls: string;
}

const absent = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readReceipt = async (
  path: string,
  input: string,
  producer: BuildProducer,
): Promise<WorkerBuildResult | undefined> => {
  let receipt: Receipt;
  try {
    receipt = JSON.parse(await readFile(path, "utf8")) as Receipt;
  } catch (error) {
    if (absent(error) || error instanceof SyntaxError) return;
    throw error;
  }
  if (
    receipt?.schema !== 1 ||
    receipt.input !== input ||
    !receipt.original?.entry ||
    !receipt.snapshot?.entry
  )
    return;
  try {
    if (receipt.controls !== (await controlDigest(producer))) return;
    const original = await captureArtifact(receipt.original);
    if (original.hash !== receipt.hash) return;
    const snapshot = await captureArtifact(receipt.snapshot);
    if (snapshot.hash === receipt.hash) return receipt.snapshot;
  } catch (error) {
    if (!absent(error)) throw error;
  }
};

const controlDigest = async (producer: BuildProducer) =>
  digest(
    canonicalBuildValue(
      await Promise.all(
        (producer.outputFiles ?? []).map(async (path) => [path, digest(await readFile(path))]),
      ),
    ),
  );

const writeReceipt = async (path: string, receipt: Receipt) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};

const resolveProducer = async (producer: BuildProducer, input: string) => {
  const root = await realpath(producer.root);
  const options = producer.reuse || {};
  const outputRoot = await realpath(resolve(root, options.outputRoot ?? "."));
  const reusable = producer.reuse !== false && producer.cacheable !== false;
  return withBuildOutput(outputRoot, async (environment) => {
    // Waiting for a competing output owner can outlive an input edit.
    if ((await fingerprint(producer)) !== input)
      throw new Error(
        "Build inputs changed while waiting for output ownership. Retry the operation.",
      );
    const receipt = resolve(outputRoot, ".renkin/build", `${input}.json`);
    const hit = reusable ? await readReceipt(receipt, input, producer) : undefined;
    if (hit) return hit;
    const original = await producer.build({ environment });
    const artifact = await captureArtifact(original, outputRoot);
    if ((await fingerprint(producer)) !== input)
      throw new Error("Build inputs changed during compilation. No reusable result was recorded.");
    const snapshot = await saveArtifact(outputRoot, input, original, artifact);
    if (reusable)
      await writeReceipt(receipt, {
        schema: 1,
        input,
        original,
        snapshot,
        hash: artifact.hash,
        controls: await controlDigest(producer),
      });
    return snapshot;
  });
};

/** Sharing lasts for one preparation only; disk receipts are independently verified. */
export const createBuildContext = (): WorkerBuildContext => {
  const pending = new Map<string, Promise<WorkerBuildResult>>();
  return {
    async resolve(producer) {
      const input = await fingerprint(producer);
      const reusable = producer.reuse !== false && producer.cacheable !== false;
      const key = reusable ? input : randomUUID();
      const previous = pending.get(key);
      if (previous) return previous;
      const result = resolveProducer(producer, input);
      pending.set(key, result);
      return result;
    },
  };
};
