import type { ResourceDefinition } from "@renkin/core/models/stack";
import { defineStack } from "renkin";
import { r2, r2Token, tanstackStart, worker } from "renkin/cloudflare";
import { graph } from "#test-fixtures/full-graph/graph.ts";

const disposable = (resource: ResourceDefinition): ResourceDefinition => ({
  ...resource,
  protection: { data: resource.protection?.data ?? false, allowDelete: true },
  retain: false,
});

const cloudFiles = () =>
  r2("Files", {
    allowDelete: true,
    forceDestroy: true,
    cors: [
      {
        allowed: { origins: ["*"], methods: ["GET", "PUT", "HEAD"], headers: ["*"] },
        exposeHeaders: ["etag"],
      },
    ],
  });

export const cloudGraph = (
  name: string,
  cron: string,
  compiled: () => void,
  scope: { readonly from: string; readonly to: string; readonly expiresAt: string },
) => {
  const original = graph({ name, cron, notification: scope });
  const files = cloudFiles();
  const token = r2Token("UploadToken", {
    buckets: [files],
    permissions: "read-write",
    expiresAt: scope.expiresAt,
    allowDelete: true,
  });
  const replacements = new Map(
    original.resources.map((resource) => [
      resource.id,
      resource.id === "Files"
        ? files
        : resource.id === "UploadToken"
          ? token
          : disposable(resource),
    ]),
  );
  return defineStack({
    name,
    resources: original.resources.map((resource) => {
      if (resource.type !== "cloudflare.worker") return replacements.get(resource.id) ?? resource;
      if ("website" in resource) {
        const website = (resource as ReturnType<typeof tanstackStart>).website;
        return tanstackStart(resource.id, {
          ...website,
          allowDelete: true,
          retain: false,
          beforeBuild: compiled,
          buildEnvironment: { ...website.buildEnvironment, PROTO_OFFLINE: "true" },
          reuse: {
            ...(website.reuse || {}),
            key: `cloud-graph-counter-v1:${name}`,
            values: { hook: "count-only" },
          },
          bindings: Object.fromEntries(
            Object.entries(website.bindings ?? {}).map(([key, binding]) => [
              key,
              typeof binding === "string"
                ? binding
                : binding.id === "Files"
                  ? files
                  : binding.id === "UploadToken"
                    ? token
                    : binding,
            ]),
          ),
        });
      }
      const options = (resource as ReturnType<typeof worker>).options;
      return worker(resource.id, {
        ...options,
        allowDelete: true,
        retain: false,
        dependencies:
          options.dependencies?.map(
            (dependency) => replacements.get(dependency.id) ?? dependency,
          ) ?? [],
      });
    }),
  });
};
