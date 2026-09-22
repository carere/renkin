import type {
  createSiteClient,
  DestinationInput,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { Json, ResourceDefinition } from "@renkin/core/models/stack";
import type { ResourceState } from "@renkin/core/models/state";
import type { ResourceService } from "@renkin/core/services/resource/resource-service";
import { Effect } from "effect";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid website resource settings.");
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || !value)
    throw new Error("A required website setting is missing.");
  return value;
};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
interface Options {
  readonly client: ReturnType<typeof createSiteClient>;
  readonly token: string;
}
const domainWorker = (
  settings: Record<string, unknown>,
  hostname: string,
  resources: Readonly<Record<string, ResourceState>>,
) =>
  Effect.gen(function* () {
    const worker = resources[string(settings.worker)];
    if (worker?.definition.type !== "cloudflare.worker")
      return yield* Effect.fail(new Error("Custom domain Worker is not provisioned."));
    if (settings.access) {
      const application = resources[string(settings.access)];
      if (application?.definition.type !== "cloudflare.access-application")
        return yield* Effect.fail(new Error("Custom domain Access protection is not provisioned."));
      const app = object(application.outputs);
      const hosts = [
        app.domain,
        ...(Array.isArray(app.destinations)
          ? app.destinations.map((destination) => object(destination).uri)
          : []),
      ];
      if (!hosts.includes(hostname))
        return yield* Effect.fail(
          new Error("Access application does not protect this custom domain."),
        );
      if (object(worker.definition.properties).workersDev !== false)
        return yield* Effect.fail(
          new Error(
            "An Access-protected custom domain requires workersDev: false to close its alternate public origin.",
          ),
        );
    }
    return worker;
  });
const domain = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => string(object(outputs).id),
  apply: (definition, _allocation, previous, resources = {}) =>
    Effect.gen(function* () {
      const settings = object(definition.properties);
      const hostname = string(settings.hostname);
      const worker = yield* domainWorker(settings, hostname, resources);
      const existing = (yield* client.listDomains(hostname)).result;
      if (existing.length > 1)
        return yield* Effect.fail(new Error("Multiple custom domain records match this hostname."));
      const observed = existing[0];
      if (
        observed &&
        ((previous && observed.id !== previous.physicalId) ||
          (observed.service !== worker.physicalId &&
            observed.service !== (previous ? object(previous.outputs).service : worker.physicalId)))
      )
        return yield* Effect.fail(
          new Error("The custom domain belongs to another Worker or ownership record."),
        );
      const result =
        observed?.service === worker.physicalId
          ? observed
          : yield* client.putDomain(
              {
                hostname,
                service: worker.physicalId,
                zoneId: string(settings.zoneId),
                previewsEnabled: false,
              },
              token,
            );
      const fresh = yield* client.getDomain(string(result.id));
      return json({ ...fresh, url: `https://${hostname}`, service: worker.physicalId });
    }),
  remove: (resource) =>
    Effect.gen(function* () {
      const prior = object(resource.outputs);
      const domains = (yield* client.listDomains(string(prior.hostname))).result;
      const existing = domains.find((item) => item.id === resource.physicalId);
      if (!existing) return;
      if (existing.service !== prior.service)
        return yield* Effect.fail(new Error("Custom domain ownership changed; refusing removal."));
      yield* client.deleteDomain(resource.physicalId, token);
    }),
});
const destinationSettings = (
  definition: ResourceDefinition,
  allocation: string,
  previous: ResourceState | undefined,
) => {
  const settings = object(definition.properties);
  const name = previous
    ? string(object(previous.outputs).ownershipName)
    : `${string(settings.name)}-${allocation}`;
  const desired = {
    name,
    enabled: settings.enabled !== false,
    configuration: {
      type: "logpush",
      url: string(settings.url),
      logpushDataset: string(settings.logpushDataset),
      headers: (settings.headers ?? {}) as Record<string, string>,
    },
  } satisfies DestinationInput;
  return desired;
};
const destination = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => string(object(outputs).slug),
  apply: (definition, allocation, previous) =>
    Effect.gen(function* () {
      const desired = destinationSettings(definition, allocation, previous);
      const { name } = desired;
      const observe = () => allDestinations(client);
      let observed = (yield* observe()).find((item) =>
        previous ? item.slug === previous.physicalId : item.name === name,
      );
      if (!observed) {
        if (previous)
          return yield* Effect.fail(
            new Error(
              "The managed observability destination is missing; explicit replacement is required.",
            ),
          );
        const created = yield* client.createDestination(desired, token);
        observed = (yield* observe()).find((item) => item.slug === created.slug);
      } else {
        if (observed.name !== name)
          return yield* Effect.fail(new Error("Observability destination ownership changed."));
        if (
          observed.enabled !== desired.enabled ||
          observed.configuration.url !== desired.configuration.url ||
          !matchingHeaders(observed.configuration.headers, desired.configuration.headers)
        ) {
          yield* client.updateDestination(
            observed.slug,
            {
              enabled: desired.enabled,
              configuration: {
                type: "logpush",
                url: desired.configuration.url,
                headers: desired.configuration.headers,
              },
            },
            token,
          );
          const slug = observed.slug;
          observed = (yield* observe()).find((item) => item.slug === slug);
        }
      }
      if (!observed)
        return yield* Effect.fail(
          new Error("The observability destination disappeared after mutation."),
        );
      // Credential-bearing destinationConf/headers are provider state, never ordinary outputs.
      return destinationOutput(observed, name);
    }),
  remove: (resource) =>
    Effect.gen(function* () {
      const observed = (yield* allDestinations(client)).find(
        (item) => item.slug === resource.physicalId,
      );
      if (!observed) return;
      if (observed.name !== object(resource.outputs).ownershipName)
        return yield* Effect.fail(
          new Error("Observability destination ownership changed; refusing removal."),
        );
      yield* client.deleteDestination(resource.physicalId, token);
    }),
});
export const cloudflareSiteServices = (options: Options): Record<string, ResourceService> => ({
  "cloudflare.custom-domain": domain(options),
  "cloudflare.observability-destination": destination(options),
});
const matchingHeaders = (observed: Record<string, unknown>, desired: Record<string, string>) => {
  const headers = Object.fromEntries(
    Object.entries(observed)
      .filter(
        ([key]) =>
          key.toLowerCase() !== "content-type" ||
          Object.keys(desired).some((name) => name.toLowerCase() === "content-type"),
      )
      .map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  const wantedHeaders = Object.fromEntries(
    Object.entries(desired).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return (
    Object.keys(headers).length === Object.keys(wantedHeaders).length &&
    Object.entries(wantedHeaders).every(([key, value]) => headers[key] === value)
  );
};
const destinationOutput = (
  observed: {
    slug: string;
    name: string;
    enabled: boolean;
    scripts: readonly string[];
    configuration: { url: string; logpushDataset: string };
  },
  name: string,
) => {
  return json({
    slug: observed.slug,
    name: observed.name,
    ownershipName: name,
    url: observed.configuration.url,
    logpushDataset: observed.configuration.logpushDataset,
    enabled: observed.enabled,
    scripts: observed.scripts,
  });
};
const allDestinations = (client: Options["client"]) =>
  Effect.gen(function* () {
    const values = [];
    for (let page = 1; ; page++) {
      const result = yield* client.listDestinations(page);
      values.push(...result.result);
      if (page >= (result.resultInfo?.totalPages ?? page)) return values;
    }
  });
