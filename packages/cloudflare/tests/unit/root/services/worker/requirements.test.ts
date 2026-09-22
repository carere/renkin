import { expect, it } from "@effect/vitest";
import type { ResourceDefinition } from "@renkin/core/models/stack";
import { Effect } from "effect";
import { kv } from "#src/contexts/root/models/kv.ts";
import { finalizeRequirements } from "#src/contexts/root/services/worker/prepare-requirements.ts";

it.effect("rejects undeclared and incorrectly typed binding targets before provisioning", () =>
  Effect.sync(() => {
    const caller: ResourceDefinition = {
      id: "caller",
      type: "cloudflare.worker",
      identity: "worker",
      properties: {
        requirements: { REMOTE: { type: "cloudflare.worker-reference", id: "target" } },
      },
    };
    expect(() => finalizeRequirements([caller])).toThrow("missing or has another type");
    expect(() => finalizeRequirements([caller, kv("target")])).toThrow(
      "missing or has another type",
    );
    expect(
      finalizeRequirements([
        {
          ...caller,
          properties: {
            requirements: {
              REMOTE: {
                type: "cloudflare.worker-reference",
                id: "outside",
                external: { name: "outside" },
              },
            },
          },
        },
      ]),
    ).toHaveLength(1);
  }),
);
