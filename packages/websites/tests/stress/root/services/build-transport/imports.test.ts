import { it } from "@effect/vitest";
import { verifyTransportImports } from "#test-support/root/build-transport/verify-imports.ts";

it("repeatedly initializes transport in fresh serial and concurrent import processes", async () => {
  for (let attempt = 0; attempt < 8; attempt++) await verifyTransportImports(true);
  for (let attempt = 0; attempt < 8; attempt++) await verifyTransportImports(false);
  await Promise.all(Array.from({ length: 4 }, () => verifyTransportImports(false)));
}, 30000);
