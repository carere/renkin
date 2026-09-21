/** Development-only credentials. This opt-in endpoint must not use production secrets. */
export interface LocalR2S3Options {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}
export const localR2S3Path = "/cdn-cgi/local/r2/s3/";
/** Path-style endpoint; the application appends its bucket/key and signs the URL. */
export const localS3Endpoint = (workerUrl: string | URL): string =>
  new URL(localR2S3Path, workerUrl).href;
