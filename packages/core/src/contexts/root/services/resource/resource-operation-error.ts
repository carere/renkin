/** Explicitly safe public diagnostics from resource adapters. Never include SQL, secrets or provider causes. */
export class ResourceOperationError extends Error {
  readonly name: string = "ResourceOperationError";
}
