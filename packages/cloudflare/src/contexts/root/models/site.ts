import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { AccessApplication, ResourceOptions } from "./access.ts";
import type { WorkerResource } from "./worker.ts";

export const customDomain = (
  id: string,
  options: ResourceOptions & {
    readonly hostname: string;
    readonly zoneId: string;
    readonly worker: WorkerResource;
    readonly access?: AccessApplication;
  },
): ResourceDefinition => ({
  id,
  type: "cloudflare.custom-domain",
  identity: options.identity ?? options.hostname,
  properties: {
    hostname: options.hostname,
    zoneId: options.zoneId,
    worker: options.worker.id,
    ...(options.access ? { access: options.access.id } : {}),
  },
  dependencies: [options.worker.id, ...(options.access ? [options.access.id] : [])],
  ...(options.retain === undefined ? {} : { retain: options.retain }),
});

export const observabilityDestination = (
  id: string,
  options: ResourceOptions & {
    readonly name: string;
    readonly url: string;
    readonly logpushDataset:
      | "opentelemetry-traces"
      | "opentelemetry-logs"
      | "opentelemetry-metrics";
    readonly enabled?: boolean;
    readonly headers?: Readonly<Record<string, string>>;
  },
): ResourceDefinition => {
  const { identity, retain, ...settings } = options;
  return {
    id,
    type: "cloudflare.observability-destination",
    identity: identity ?? `${id}:${options.name}:${options.logpushDataset}`,
    properties: JSON.parse(JSON.stringify(settings)) as Json,
    ...(retain === undefined ? {} : { retain }),
  };
};
