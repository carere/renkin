import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";
import { Miniflare } from "miniflare";
import type { NativeR2 } from "../../../src/contexts/root/models/r2.ts";
import { bundleWorker } from "../../../src/contexts/root/services/bundler/worker-bundler.ts";

interface SignOptions {
  readonly bucket?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly query?: Record<string, string>;
  readonly datetime?: string;
}

export const credentials = { accessKeyId: "local-access", secretAccessKey: "local-secret" };
export const signer = new AwsClient({ ...credentials, service: "s3", region: "auto" });
export const createS3Fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "renkin-r2-"));
  const entry = fileURLToPath(
    new URL("../../../src/contexts/root/services/r2-s3/s3-worker.ts", import.meta.url),
  );
  const { code } = await bundleWorker(entry, { sourceMap: false });
  const start = () =>
    new Miniflare({
      host: "127.0.0.1",
      port: 0,
      defaultPersistRoot: directory,
      workers: [
        {
          name: "s3",
          script: code,
          modules: true,
          compatibilityDate: "2026-07-30",
          r2Buckets: { A: "bucket-a", B: "bucket-b" },
          bindings: { RENKIN_S3: { ...credentials, buckets: { first: "A", second: "B" } } },
          serviceBindings: { ORIGINAL: "original" },
        },
        {
          name: "original",
          script: 'export default {fetch(){return new Response("application fallback")}}',
          modules: true,
          compatibilityDate: "2026-07-30",
        },
      ],
    });
  let runtime = start();
  let url = String(await runtime.ready);
  const signed = async (method: string, key: string, options: SignOptions = {}) => {
    const target = new URL(
      `/cdn-cgi/local/r2/s3/${options.bucket ?? "first"}/${key.split("/").map(encodeURIComponent).join("/")}`,
      url,
    );
    for (const [name, value] of Object.entries(options.query ?? {}))
      target.searchParams.set(name, value);
    return signer.sign(target, {
      method,
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body === undefined ? {} : { body: options.body }),
      aws: {
        signQuery: true,
        allHeaders: true,
        ...(options.datetime ? { datetime: options.datetime } : {}),
      },
    });
  };
  return {
    signed,
    url: () => url,
    bucket: async (name: "A" | "B" = "A"): Promise<NativeR2> =>
      (await runtime.getR2Bucket(name, "s3")) as unknown as NativeR2,
    restart: async () => {
      await runtime.dispose();
      runtime = start();
      url = String(await runtime.ready);
    },
    close: async () => {
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
};
