import * as R2 from "@distilled.cloud/cloudflare/r2";
import { Data, Effect } from "effect";
import type { CloudflareConfig, MutationGateway } from "./cloudflare-client.ts";
import { createOperationClient } from "./operation-client.ts";

export class R2ObjectKeyError extends Data.TaggedError("R2ObjectKeyError")<{
  readonly message: string;
}> {}

// rc.12 encodes label slashes, but R2 object deletion requires literal path separators.
const objectGateway = (gateway: MutationGateway): MutationGateway => ({
  request: (request, token) => {
    const marker = "/objects/";
    const index = request.path.indexOf(marker);
    if (request.method !== "DELETE" || index < 0)
      throw new Error("Unexpected R2 object operation.");
    return gateway.request(
      {
        ...request,
        path:
          request.path.slice(0, index + marker.length) +
          request.path.slice(index + marker.length).replace(/%2F/gi, "/"),
      },
      token,
    );
  },
});

/** Management reads are bounded; every mutation uses the account's fenced gateway without retry. */
export const createR2Client = (config: CloudflareConfig, gateway: MutationGateway) => {
  const transport = createOperationClient(config, gateway);
  const objectTransport = createOperationClient(config, objectGateway(gateway));
  return {
    create: (input: Omit<R2.CreateBucketRequest, "accountId">, token: string) =>
      transport.write(R2.createBucket({ ...input, accountId: config.accountId }), token),
    get: (bucketName: string, jurisdiction?: string) =>
      transport.read(
        R2.getBucket({
          accountId: config.accountId,
          bucketName,
          ...(jurisdiction ? { jurisdiction } : {}),
        }),
      ),
    update: (input: Omit<R2.PatchBucketRequest, "accountId">, token: string) =>
      transport.write(R2.patchBucket({ ...input, accountId: config.accountId }), token),
    remove: (bucketName: string, jurisdiction: string, token: string) =>
      transport.write(
        R2.deleteBucket({ accountId: config.accountId, bucketName, jurisdiction }),
        token,
      ),
    cors: (bucketName: string, jurisdiction: string) =>
      transport.read(R2.getBucketCors({ accountId: config.accountId, bucketName, jurisdiction })),
    setCors: (input: Omit<R2.PutBucketCorsRequest, "accountId">, token: string) =>
      transport.write(R2.putBucketCors({ ...input, accountId: config.accountId }), token),
    clearCors: (bucketName: string, jurisdiction: string, token: string) =>
      transport.write(
        R2.deleteBucketCors({ accountId: config.accountId, bucketName, jurisdiction }),
        token,
      ),
    objects: (input: Omit<R2.ListBucketObjectsRequest, "accountId">) =>
      transport.read(R2.listBucketObjects({ ...input, accountId: config.accountId })),
    removeObject: (bucketName: string, objectKey: string, jurisdiction: string, token: string) =>
      Effect.suspend(
        (): Effect.Effect<
          R2.DeleteBucketObjectResponse,
          R2.DeleteBucketObjectError | R2ObjectKeyError
        > => {
          if (objectKey.split("/").some((segment) => segment === "." || segment === ".."))
            return Effect.fail(
              new R2ObjectKeyError({
                message:
                  "The management API cannot safely address an object key with dot path segments. Remove it through the native bucket binding before retrying.",
              }),
            );
          return objectTransport.write(
            R2.deleteBucketObject({
              accountId: config.accountId,
              bucketName,
              objectName: objectKey,
              cfR2Jurisdiction: jurisdiction,
            }),
            token,
          );
        },
      ),
  };
};
export type R2CorsRule = NonNullable<R2.PutBucketCorsRequest["rules"]>[number];
