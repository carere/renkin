import { join } from "node:path";
import { execute, type InstalledConsumer } from "./consumer.ts";

export const verifyApplications = async (consumer: InstalledConsumer) => {
  const failures: Error[] = [];
  for (const name of ["example-spa", "example-ssr", "example-static", "website"]) {
    try {
      const result = await execute(
        process.execPath,
        ["--bun", "vitest", "run", "--project", "integration"],
        {
          cwd: join(consumer.directory, "apps", name),
          env: consumer.env,
          timeout: 150000,
          maxBuffer: 300000,
        },
      );
      console.info(
        `installed ${name}: ${result.stdout.match(/Tests\s+.*passed/)?.[0] ?? "completed"}`,
      );
    } catch (cause) {
      failures.push(new Error(`Installed ${name} failed.`, { cause }));
      console.error(`installed ${name}: FAILED`, cause);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Installed framework checks failed.");
};
