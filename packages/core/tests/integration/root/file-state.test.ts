import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { emptyState } from "../../../src/contexts/root/models/state.ts";
import { FileStateRepository } from "../../../src/contexts/root/services/state/file-state-repository.ts";

it.effect(
  "owner-only files persist across instances; locks reject immediately and isolate environments",
  () =>
    Effect.promise(async () => {
      const directory = await mkdtemp(join(tmpdir(), "renkin-state-"));
      const repository = new FileStateRepository(directory);
      try {
        const lease = await repository.acquire("app", "dev");
        try {
          await lease.write(emptyState("app", "dev"));
          expect((await stat(join(directory, "app/dev.json"))).mode & 0o777).toBe(0o600);
          expect(await new FileStateRepository(directory).list("app")).toEqual(["dev"]);
          await expect(repository.acquire("app", "dev")).rejects.toThrow("already being changed");
          const independent = await repository.acquire("app", "other");
          await independent.release();
        } finally {
          await lease.release();
        }
        const next = await repository.acquire("app", "dev");
        await next.release();
        expect(
          JSON.parse(await readFile(join(directory, "app/dev.json"), "utf8")).environment,
        ).toBe("dev");
        expect(await repository.read("app", "missing")).toBeUndefined();
        await writeFile(join(directory, "app/dev.json"), "corrupted");
        await expect(repository.read("app", "dev")).rejects.toThrow("could not be read");
        await expect(repository.list("app")).rejects.toThrow("could not be listed");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }),
);

it.effect("a killed process releases its lock without waiting for a stale timeout", () =>
  Effect.promise(async () => {
    const { spawn } = await import("node:child_process");
    const directory = await mkdtemp(join(tmpdir(), "renkin-crash-"));
    const modulePath = new URL(
      "../../../src/contexts/root/services/state/file-state-repository.ts",
      import.meta.url,
    ).href;
    const script = `import {FileStateRepository} from ${JSON.stringify(modulePath)}; const lease=await new FileStateRepository(${JSON.stringify(directory)}).acquire("app","dev");console.log("locked");setInterval(()=>void lease.read(),1000);`;
    const child = spawn(
      process.execPath,
      [
        ...(process.versions.bun ? [] : ["--experimental-transform-types"]),
        "--input-type=module",
        "-e",
        script,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(() => {
          throw new Error("Lock-holder child exited before acquiring its lock.");
        }),
      ]);
      const repository = new FileStateRepository(directory);
      await expect(repository.acquire("app", "dev")).rejects.toThrow("already being changed");
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
      const lease = await repository.acquire("app", "dev");
      await lease.release();
    } finally {
      child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  }),
);
