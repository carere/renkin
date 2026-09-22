export interface R2TokenRequirement {
  readonly type: "cloudflare.r2-token";
  readonly id: string;
}
export interface R2Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly endpoint: string;
  readonly region: "auto";
  readonly buckets: Readonly<Record<string, string>>;
}
/** Credentials are a secret binding. Applications own signing; Renkin supplies configuration only. */
export const r2TokenClient = (value: unknown) => {
  let config: unknown;
  try {
    config = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Invalid R2 credential binding.");
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Invalid R2 credential binding.");
  const item = config as Record<string, unknown>;
  if (
    typeof item.accessKeyId !== "string" ||
    !item.accessKeyId ||
    typeof item.secretAccessKey !== "string" ||
    !item.secretAccessKey ||
    typeof item.endpoint !== "string" ||
    !item.endpoint ||
    item.region !== "auto" ||
    !item.buckets ||
    typeof item.buckets !== "object" ||
    Array.isArray(item.buckets) ||
    !Object.values(item.buckets).every((bucket) => typeof bucket === "string" && bucket.length > 0)
  )
    throw new Error("Invalid R2 credential binding.");
  const credentials = config as R2Credentials;
  return {
    /** Resolve the opt-in local endpoint against this Worker's incoming request URL. */
    forRequest: (request: Request): R2Credentials => ({
      ...credentials,
      endpoint: new URL(credentials.endpoint, request.url).href,
    }),
  };
};
export type R2TokenClient = ReturnType<typeof r2TokenClient>;
