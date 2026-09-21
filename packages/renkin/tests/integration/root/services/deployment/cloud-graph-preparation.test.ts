import { expect, it } from "@effect/vitest";
import { prepareStack } from "@renkin/cloudflare/services/worker/prepare-stack";
import { emptyState } from "@renkin/core/models/state";
import { plan } from "@renkin/core/use-cases/plan";
import { stackDefinition } from "#src/contexts/root/services/deployment/stack-definition.ts";
import { cloudGraph } from "#test-support/root/cloud-full-graph/cloud-stack.ts";

it("prepares the disposable cloud graph without reintroducing protected authoring resources", async () => {
  const graph = cloudGraph("renkin-test-offline-graph", "0 0 1 1 *", () => {}, {
    from: "sender@example.com",
    to: "recipient@example.com",
    expiresAt: "2026-09-22T21:59:59Z",
  });
  const prepared = stackDefinition(await prepareStack(graph));
  expect(prepared.resources).toHaveLength(17);
  for (const resource of prepared.resources) {
    expect(resource.protection?.allowDelete, resource.id).toBe(true);
    expect(resource.retain, resource.id).not.toBe(true);
  }
  expect(structuredClone(prepared)).toEqual(prepared);
  const changes = plan(prepared, emptyState(graph.name, "offline"));
  expect(changes).toHaveLength(17);
  expect(changes.every((change) => change.kind === "create")).toBe(true);
  for (const id of ["Console", "CustomerHub", "Storefront"]) {
    expect(prepared.resources.find((resource) => resource.id === id)?.references).toEqual(
      expect.arrayContaining(["API", "Auth", "Tracking"]),
    );
  }
}, 90000);
