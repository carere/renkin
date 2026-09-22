import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Semaphore } from "effect";
import { validateName } from "#src/contexts/root/models/stack.ts";
import { decodeState, type EnvironmentState } from "#src/contexts/root/models/state.ts";
import { assertEmptyState } from "./empty-state.ts";
import { StateError, type StateLease, type StateRepository } from "./state-repository.ts";

const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const invalid = (error: unknown) =>
  error instanceof StateError
    ? error
    : new StateError("invalid", "Invalid environment state operation.");
const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new StateError("unreadable", "Environment state storage operation failed."),
  });

/** JSON state remains an ordinary owner-only file. SQLite supplies OS-managed crash-safe locks. */
export class FileStateRepository implements StateRepository {
  constructor(readonly directory: string) {}
  private location(stack: string, environment: string) {
    return Effect.try({
      try: () => {
        validateName(stack);
        validateName(environment);
        return join(this.directory, stack, `${environment}.json`);
      },
      catch: invalid,
    });
  }
  read(stack: string, environment: string) {
    return Effect.gen({ self: this }, function* () {
      const path = yield* this.location(stack, environment);
      const source = yield* Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          missing(error)
            ? Effect.succeed(undefined)
            : Effect.fail(new StateError("unreadable", "Environment state could not be read.")),
        ),
      );
      if (source === undefined) return undefined;
      return yield* Effect.try({
        try: () => decodeState(source, stack, environment),
        catch: () =>
          new StateError("unreadable", "Environment state could not be read or decoded."),
      });
    });
  }
  list(stack: string) {
    return Effect.gen({ self: this }, function* () {
      yield* Effect.try({ try: () => validateName(stack), catch: invalid });
      const files = yield* Effect.tryPromise({
        try: () => readdir(join(this.directory, stack)),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          missing(error)
            ? Effect.succeed([] as string[])
            : Effect.fail(new StateError("unreadable", "Environment state could not be listed.")),
        ),
      );
      const names = files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
      yield* Effect.forEach(names, (name) => this.read(stack, name));
      return names.sort();
    }).pipe(
      Effect.mapError(() => new StateError("unreadable", "Environment state could not be listed.")),
    );
  }
  acquire(stack: string, environment: string): Effect.Effect<StateLease, StateError> {
    return Effect.uninterruptible(
      Effect.gen({ self: this }, function* () {
        const path = yield* this.location(stack, environment);
        yield* io(() => mkdir(this.directory, { recursive: true, mode: 0o700 }));
        yield* io(() => mkdir(join(this.directory, stack), { recursive: true, mode: 0o700 }));
        const lockPath = `${path}.lock.sqlite`;
        yield* Effect.acquireUseRelease(
          io(() => open(lockPath, "a", 0o600)),
          () => Effect.void,
          (file) => io(() => file.close()),
        );
        const database = yield* Effect.try({
          try: () => new DatabaseSync(lockPath),
          catch: invalid,
        });
        yield* Effect.try({
          try: () => database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;"),
          catch: () =>
            new StateError("busy", `Environment ${stack}/${environment} is already being changed.`),
        }).pipe(Effect.onError(() => Effect.sync(() => database.close())));
        return this.lease(database, path, stack, environment);
      }),
    );
  }
  private lease(
    database: DatabaseSync,
    path: string,
    stack: string,
    environment: string,
  ): StateLease {
    let closing = false;
    let closed = false;
    let removed = false;
    const mutex = Semaphore.makeUnsafe(1);
    const schedule = <A>(operation: Effect.Effect<A, StateError>) =>
      Effect.uninterruptible(
        Effect.suspend(() => {
          if (closing || removed)
            return Effect.fail(new StateError("busy", "The environment lease has ended."));
          return mutex.withPermit(
            Effect.suspend(() =>
              removed
                ? Effect.fail(new StateError("busy", "The environment lease has ended."))
                : operation,
            ),
          );
        }),
      );
    return {
      token: randomUUID(),
      read: () => schedule(this.read(stack, environment)),
      write: (state) => schedule(this.write(path, stack, environment, state)),
      removeEmpty: () =>
        schedule(
          Effect.gen({ self: this }, function* () {
            const state = yield* this.read(stack, environment);
            yield* Effect.try({ try: () => assertEmptyState(state), catch: invalid });
            yield* Effect.tryPromise({ try: () => unlink(path), catch: (error) => error }).pipe(
              Effect.catch((error) =>
                missing(error)
                  ? Effect.void
                  : Effect.fail(
                      new StateError("unreadable", "Environment state could not be removed."),
                    ),
              ),
            );
            yield* this.syncDirectory(stack);
            removed = true;
          }),
        ),
      release: () =>
        Effect.uninterruptible(
          Effect.suspend(() => {
            closing = true;
            return mutex.withPermit(
              Effect.suspend(() => {
                if (closed) return Effect.void;
                closed = true;
                return Effect.try({ try: () => database.exec("ROLLBACK"), catch: invalid }).pipe(
                  Effect.ensuring(Effect.sync(() => database.close())),
                );
              }),
            );
          }),
        ),
    };
  }
  private syncDirectory(stack: string) {
    return Effect.acquireUseRelease(
      io(() => open(join(this.directory, stack), "r")),
      (directory) => io(() => directory.sync()),
      (directory) => io(() => directory.close()),
    );
  }
  private write(path: string, stack: string, environment: string, state: EnvironmentState) {
    return Effect.gen({ self: this }, function* () {
      if (state.stack !== stack || state.environment !== environment)
        return yield* Effect.fail(new StateError("invalid", "State ownership mismatch."));
      const temporary = `${path}.${randomUUID()}.tmp`;
      const source = yield* Effect.try({ try: () => JSON.stringify(state), catch: invalid });
      yield* Effect.acquireUseRelease(
        io(() => open(temporary, "wx", 0o600)),
        (handle) =>
          io(() => handle.writeFile(source)).pipe(Effect.andThen(io(() => handle.sync()))),
        (handle) => io(() => handle.close()),
      );
      yield* io(() => rename(temporary, path));
      yield* this.syncDirectory(stack);
    });
  }
}
