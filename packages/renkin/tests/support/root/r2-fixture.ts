import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineStack, development } from "@carere/renkin";
import { r2, worker } from "@carere/renkin/cloudflare";
import { localS3Endpoint } from "@carere/renkin/worker";
import { AwsClient } from "aws4fetch";
import { Effect } from "effect";

const credentials = { accessKeyId: "public-local-key", secretAccessKey: "public-local-secret" };
const signer = new AwsClient({ ...credentials, service: "s3", region: "auto" });
export const signedR2 = (
  base: string,
  bucket: string,
  key: string,
  method = "GET",
  body?: string,
) =>
  signer.sign(
    `${localS3Endpoint(base)}${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`,
    { method, ...(body === undefined ? {} : { body }), aws: { signQuery: true } },
  );
export const createR2Fixture = async () => {
  const root = await mkdtemp(fileURLToPath(new URL("../../fixtures/r2-", import.meta.url)));
  const entry = join(root, "worker.ts");
  await writeFile(
    entry,
    `import {Effect} from "effect";import {r2} from "@carere/renkin/cloudflare";import {defineWorker} from "@carere/renkin/worker";
export default defineWorker({Files:r2("Files")},({Files})=>({fetch:request=>Effect.gen(function*(){
 if(new URL(request.url).pathname!=="/native")return new Response("application");
 const object=yield* Files.get("object");return new Response(object?yield* Effect.promise(()=>object.text()):"missing");
})}));`,
  );
  const stack = defineStack({
    name: "r2-public",
    resources: [
      r2("Files"),
      r2("Other"),
      worker("Api", { entry, compatibilityDate: "2026-07-30" }),
    ],
  });
  const run = <A>(
    action: (session: Effect.Success<ReturnType<typeof development>>) => Promise<A>,
    desired = stack,
    s3 = true,
    environment = "local",
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* development(desired, {
            directory: join(root, "state"),
            watch: false,
            environment,
            ...(s3 ? { r2S3: credentials } : {}),
          });
          return yield* Effect.promise(() => action(session));
        }),
      ),
    );
  return { root, entry, stack, run, close: () => rm(root, { recursive: true, force: true }) };
};
