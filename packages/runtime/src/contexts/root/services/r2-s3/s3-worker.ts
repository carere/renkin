import { type LocalR2S3Options, localR2S3Path } from "#src/contexts/root/models/local-r2-s3.ts";
import type { NativeR2 } from "#src/contexts/root/models/r2.ts";
import { handleLocalR2S3 } from "./s3-handler.ts";

interface Environment {
  readonly RENKIN_S3: LocalR2S3Options & { readonly buckets: Readonly<Record<string, string>> };
  readonly ORIGINAL: { fetch(request: Request): Promise<Response> };
  readonly [name: string]: unknown;
}
export default {
  fetch(request: Request, environment: Environment): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith(localR2S3Path))
      return environment.ORIGINAL.fetch(request);
    const buckets = Object.fromEntries(
      Object.entries(environment.RENKIN_S3.buckets).map(([name, binding]) => [
        name,
        environment[binding] as NativeR2,
      ]),
    );
    return handleLocalR2S3(request, buckets, environment.RENKIN_S3);
  },
};
