import { Effect } from "effect";
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
const stages = new Set([
  "load-tanstack-development",
  "invoke-tanstack-development",
  "prepare-tanstack-directory",
  "create-vite-server",
  "listen-vite-server",
  "create-forwarding-build",
  "wrap-framework-build",
  "close-framework-session",
]);
const tooling = [
  ["vite", /node_modules\/vite\/dist\/[^\s():]+:(\d+):(\d+)/],
  ["tanstack", /node_modules\/@tanstack\/[^/]+\/dist\/[^\s():]+:(\d+):(\d+)/],
  ["miniflare", /node_modules\/miniflare\/dist\/[^\s():]+:(\d+):(\d+)/],
  ["wrangler", /node_modules\/wrangler\/wrangler-dist\/[^\s():]+:(\d+):(\d+)/],
  ["srvx", /node_modules\/srvx\/dist\/[^\s():]+:(\d+):(\d+)/],
] as const;

const stackLocations = (stack: unknown) => {
  if (typeof stack !== "string") return [];
  return stack
    .split("\n")
    .slice(1, 12)
    .flatMap((frame) => {
      for (const [module, pattern] of tooling) {
        const match = frame.match(pattern);
        if (match) return [{ module, line: Number(match[1]), column: Number(match[2]) }];
      }
      return [];
    })
    .slice(0, 3);
};

const own = (error: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(error, key)?.value;

// V8 exposes Error.stack through a shared native accessor; Bun uses a data property.
// Read only that known accessor, never an arbitrary user-supplied stack getter.
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), "stack")?.get;
const errorStack = (error: object): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(error, "stack");
  if (descriptor && "value" in descriptor) return descriptor.value;
  if (!nativeStackGetter || descriptor?.get !== nativeStackGetter) return undefined;
  try {
    return nativeStackGetter.call(error);
  } catch {
    return undefined;
  }
};

/** Never retain user messages, paths, stacks, arbitrary codes, or the original exception. */
export const startupFailure = (phase: StartupPhase, error: unknown): Error => {
  const failures: {
    name: string;
    code?: string;
    stage?: string;
    locations?: ReturnType<typeof stackLocations>;
  }[] = [];
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
    const stage = own(error, "stage");
    const locations = stackLocations(errorStack(error));
    failures.push({
      name: typeof name === "string" && names.has(name) ? name : "unknown",
      ...(typeof code === "string" && codes.has(code) ? { code } : {}),
      ...(typeof stage === "string" && stages.has(stage) ? { stage } : {}),
      ...(locations.length ? { locations } : {}),
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
  run<T, E, R>(phase: StartupPhase, action: Effect.Effect<T, E, R>): Effect.Effect<T, E, R> {
    return Effect.suspend(() => {
      this.phase = phase;
      return action;
    });
  },
});
