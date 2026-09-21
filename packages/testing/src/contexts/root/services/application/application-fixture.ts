import { Effect, Exit, Scope, Semaphore } from "effect";

/** Recreate a scoped application against the same caller-owned persistence directory. */
export const applicationFixture = <Session, Error, Requirements>(
  create: () => Effect.Effect<Session, Error, Requirements | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const lock = Semaphore.makeUnsafe(1);
    let scope = yield* Scope.make();
    let current: Session | undefined;
    let closed = false;
    yield* Effect.addFinalizer(() =>
      lock.withPermit(
        Effect.suspend(() => {
          closed = true;
          current = undefined;
          return Scope.close(scope, Exit.void);
        }),
      ),
    );
    current = yield* Scope.provide(scope)(Effect.suspend(create));
    const restart = lock.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (closed) return yield* Effect.die(new Error("Application fixture is closed."));
          current = undefined;
          yield* Scope.close(scope, Exit.void);
          scope = yield* Scope.make();
          current = yield* Scope.provide(scope)(Effect.suspend(create));
          return current;
        }),
      ),
    );
    return {
      get current(): Session {
        if (closed || current === undefined) throw new Error("Application fixture is not running.");
        return current;
      },
      restart,
    };
  });
