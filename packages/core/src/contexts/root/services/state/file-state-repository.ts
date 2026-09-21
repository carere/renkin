import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateName } from "../../models/stack.ts";
import { decodeState, type EnvironmentState } from "../../models/state.ts";
import { StateError, type StateLease, type StateRepository } from "./state-repository.ts";

const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** JSON state remains an ordinary owner-only file. SQLite supplies OS-managed crash-safe locks. */
export class FileStateRepository implements StateRepository {
  constructor(readonly directory: string) {}

  private location(stack: string, environment: string): string {
    validateName(stack);
    validateName(environment);
    return join(this.directory, stack, `${environment}.json`);
  }

  async read(stack: string, environment: string): Promise<EnvironmentState | undefined> {
    try {
      return decodeState(
        await readFile(this.location(stack, environment), "utf8"),
        stack,
        environment,
      );
    } catch (error) {
      if (missing(error)) return undefined;
      throw new StateError("unreadable", "Environment state could not be read or decoded.");
    }
  }

  async list(stack: string): Promise<readonly string[]> {
    validateName(stack);
    try {
      const files = await readdir(join(this.directory, stack));
      const names = files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
      // Do not report corrupted or unreadable records as valid environments.
      await Promise.all(names.map((name) => this.read(stack, name)));
      return names.sort();
    } catch (error) {
      if (missing(error)) return [];
      throw new StateError("unreadable", "Environment state could not be listed.");
    }
  }

  async acquire(stack: string, environment: string): Promise<StateLease> {
    const path = this.location(stack, environment);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await mkdir(join(this.directory, stack), { recursive: true, mode: 0o700 });
    const lockPath = `${path}.lock.sqlite`;
    const file = await open(lockPath, "a", 0o600);
    await file.close();
    const database = new DatabaseSync(lockPath);
    try {
      database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
    } catch {
      database.close();
      throw new StateError("busy", `Environment ${stack}/${environment} is already being changed.`);
    }
    let released = false;
    const active = (): void => {
      if (released) throw new StateError("busy", "The environment lock has been released.");
    };
    return {
      token: randomUUID(),
      read: () => {
        active();
        return this.read(stack, environment);
      },
      write: async (state) => {
        active();
        await this.write(path, stack, environment, state);
      },
      release: async () => {
        if (released) return;
        released = true;
        database.exec("ROLLBACK");
        database.close();
      },
    };
  }

  private async write(
    path: string,
    stack: string,
    environment: string,
    state: EnvironmentState,
  ): Promise<void> {
    if (state.stack !== stack || state.environment !== environment)
      throw new StateError("invalid", "State ownership mismatch.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    const directory = await open(join(this.directory, stack), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
