export type StartupPhase =
  | "acquire-state"
  | "frameworks"
  | "prepare-stack"
  | "read-state"
  | "prepare-resources"
  | "write-state"
  | "start-runtime"
  | "migrations"
  | "connect-frameworks"
  | "cleanup";

const names = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AggregateError",
  "MiniflareCoreError",
  "MiniflareError",
  "AbortError",
  "TimeoutError",
]);
const codes = new Set([
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "EACCES",
  "EPERM",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "ENOENT",
  "EEXIST",
  "ENOTDIR",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ERR_RUNTIME_FAILURE",
  "ERR_DISPOSED",
  "ERR_MODULE_NOT_FOUND",
]);
const own = (error: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(error, key)?.value;

/** Never retain user messages, paths, stacks, arbitrary codes, or the original exception. */
export const startupFailure = (phase: StartupPhase, error: unknown): Error => {
  const failures: { name: string; code?: string }[] = [];
  for (let depth = 0; depth < 3 && typeof error === "object" && error !== null; depth++) {
    const name =
      own(error, "name") ??
      (error instanceof TypeError
        ? "TypeError"
        : error instanceof RangeError
          ? "RangeError"
          : error instanceof SyntaxError
            ? "SyntaxError"
            : error instanceof AggregateError
              ? "AggregateError"
              : error instanceof Error
                ? "Error"
                : "unknown");
    const code = own(error, "code");
    failures.push({
      name: typeof name === "string" && names.has(name) ? name : "unknown",
      ...(typeof code === "string" && codes.has(code) ? { code } : {}),
    });
    error = own(error, "cause");
  }
  const diagnostic = { phase, failures };
  // Bun does not render object Error.cause values in uncaught errors. Keep stderr useful.
  console.error(`[renkin:startup] ${JSON.stringify(diagnostic)}`);
  return new Error("Local application startup failed.", { cause: diagnostic });
};

export const startupTrace = () => ({
  phase: "acquire-state" as StartupPhase,
  async run<T>(phase: StartupPhase, action: () => Promise<T>): Promise<T> {
    this.phase = phase;
    return action();
  },
});
