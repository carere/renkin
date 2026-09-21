import type {
  createSiteClient,
  DestinationInput,
} from "@renkin/cloudflare-sdk/services/cloudflare-client/site-client";
import type { Json } from "@renkin/core/models/stack";
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
const domain = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => string(object(outputs).id),
  apply: async (definition, _allocation, previous, resources = {}) => {
    const settings = object(definition.properties);
    const hostname = string(settings.hostname);
    const worker = resources[string(settings.worker)];
    if (worker?.definition.type !== "cloudflare.worker")
      throw new Error("Custom domain Worker is not provisioned.");
    if (settings.access) {
      const application = resources[string(settings.access)];
      if (application?.definition.type !== "cloudflare.access-application")
        throw new Error("Custom domain Access protection is not provisioned.");
      const app = object(application.outputs);
      const hosts = [
        app.domain,
        ...(Array.isArray(app.destinations)
          ? app.destinations.map((destination) => object(destination).uri)
          : []),
      ];
      if (!hosts.includes(hostname))
        throw new Error("Access application does not protect this custom domain.");
      if (object(worker.definition.properties).workersDev !== false)
        throw new Error(
          "An Access-protected custom domain requires workersDev: false to close its alternate public origin.",
        );
    }
    const existing = (await Effect.runPromise(client.listDomains(hostname))).result;
    if (existing.length > 1) throw new Error("Multiple custom domain records match this hostname.");
    const observed = existing[0];
    if (
      observed &&
      ((previous && observed.id !== previous.physicalId) || observed.service !== worker.physicalId)
    )
      throw new Error("The custom domain belongs to another Worker or ownership record.");
    const result =
      observed ??
      (await Effect.runPromise(
        client.putDomain(
          {
            hostname,
            service: worker.physicalId,
            zoneId: string(settings.zoneId),
            previewsEnabled: false,
          },
          token,
        ),
      ));
    const fresh = await Effect.runPromise(client.getDomain(string(result.id)));
    return json({ ...fresh, url: `https://${hostname}`, service: worker.physicalId });
  },
  remove: async (resource) => {
    const prior = object(resource.outputs);
    const domains = (await Effect.runPromise(client.listDomains(string(prior.hostname)))).result;
    const existing = domains.find((item) => item.id === resource.physicalId);
    if (!existing) return;
    if (existing.service !== prior.service)
      throw new Error("Custom domain ownership changed; refusing removal.");
    await Effect.runPromise(client.deleteDomain(resource.physicalId, token));
  },
});

const destination = ({ client, token }: Options): ResourceService => ({
  refresh: true,
  resolvePhysicalId: (_definition, _allocation, outputs) => string(object(outputs).slug),
  apply: async (definition, allocation, previous) => {
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
    const observe = async () => (await Effect.runPromise(client.listDestinations())).result;
    let observed = (await observe()).find((item) =>
      previous ? item.slug === previous.physicalId : item.name === name,
    );
    if (!observed) {
      if (previous)
        throw new Error(
          "The managed observability destination is missing; explicit replacement is required.",
        );
      const created = await Effect.runPromise(client.createDestination(desired, token));
      observed = (await observe()).find((item) => item.slug === created.slug);
    } else {
      if (observed.name !== name) throw new Error("Observability destination ownership changed.");
      if (
        observed.enabled !== desired.enabled ||
        observed.configuration.url !== desired.configuration.url ||
        !matchingHeaders(observed.configuration.headers, desired.configuration.headers)
      ) {
        await Effect.runPromise(
          client.updateDestination(
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
          ),
        );
        const slug = observed.slug;
        observed = (await observe()).find((item) => item.slug === slug);
      }
    }
    if (!observed) throw new Error("The observability destination disappeared after mutation.");
    // Credential-bearing destinationConf/headers are provider state, never ordinary outputs.
    return destinationOutput(observed, name);
  },
  remove: async (resource) => {
    const observed = (await Effect.runPromise(client.listDestinations())).result.find(
      (item) => item.slug === resource.physicalId,
    );
    if (!observed) return;
    if (observed.name !== object(resource.outputs).ownershipName)
      throw new Error("Observability destination ownership changed; refusing removal.");
    await Effect.runPromise(client.deleteDestination(resource.physicalId, token));
  },
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
