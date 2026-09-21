import type { Json, ResourceDefinition } from "@renkin/core/models/stack";

const object = (value: Json | undefined): Readonly<Record<string, Json>> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid background resource properties.");
  return value as Readonly<Record<string, Json>>;
};
const consumerPolicy = (value: Readonly<Record<string, Json>>) => {
  for (const [name, minimum, maximum] of [
    ["maxBatchSize", 1, 100],
    ["maxBatchTimeout", 0, 60],
    ["maxRetries", 0, 100],
    ["retryDelay", 0, 86400],
    ["maxConcurrency", 1, 250],
  ] as const) {
    const configured = value[name];
    if (name === "maxConcurrency" && configured === null) continue;
    if (
      configured !== undefined &&
      (typeof configured !== "number" ||
        !Number.isInteger(configured) ||
        configured < minimum ||
        configured > maximum)
    )
      throw new Error(`Invalid queue consumer ${name}.`);
  }
};
const validateConsumers = (resources: readonly ResourceDefinition[]) => {
  const claimed = new Set<string>();
  for (const resource of resources.filter((item) => item.type === "cloudflare.worker")) {
    const properties = object(resource.properties);
    const consumers = properties.consumers ?? [];
    if (!Array.isArray(consumers)) throw new Error("Invalid queue consumers.");
    for (const input of consumers) {
      const value = object(input);
      if (typeof value.queue !== "string" || claimed.has(value.queue))
        throw new Error("Queues must have one declared consumer.");
      claimed.add(value.queue);
      for (const id of [value.queue, value.deadLetterQueue])
        if (
          id !== undefined &&
          !resources.some((target) => target.id === id && target.type === "cloudflare.queue")
        )
          throw new Error("Queue consumer target is not a declared queue.");
      if (value.deadLetterQueue === value.queue)
        throw new Error("A queue cannot be its own dead-letter queue.");
      consumerPolicy(value);
    }
    const crons = properties.crons ?? [];
    if (
      !Array.isArray(crons) ||
      !crons.every((cron) => typeof cron === "string" && cron.trim().split(/\s+/).length === 5)
    )
      throw new Error("Cron schedules require five-field expressions.");
  }
};

/** Owning Worker protection is part of the prepared whole plan, even before first use. */
export const prepareBackgroundResources = (
  resources: readonly ResourceDefinition[],
): readonly ResourceDefinition[] => {
  validateConsumers(resources);
  for (const resource of resources.filter((item) => item.type === "cloudflare.queue")) {
    const properties = object(resource.properties);
    for (const [name, maximum] of [
      ["deliveryDelay", 86400],
      ["messageRetentionPeriod", 1209600],
    ] as const) {
      const value = properties[name];
      if (
        value !== undefined &&
        (typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < (name === "deliveryDelay" ? 0 : 60) ||
          value > maximum)
      )
        throw new Error(`Invalid queue ${name}.`);
    }
  }
  const classes = new Map<string, string[]>();
  for (const resource of resources.filter((item) => item.type === "cloudflare.workflow")) {
    const { worker, className } = object(resource.properties);
    if (
      typeof worker !== "string" ||
      !resources.some((item) => item.id === worker && item.type === "cloudflare.worker")
    )
      throw new Error("Workflow owner must be a declared Worker.");
    if (
      typeof className !== "string" ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className) ||
      className === "default"
    )
      throw new Error("Invalid Workflow class name.");
    const owned = classes.get(worker) ?? [];
    owned.push(className);
    classes.set(worker, owned);
  }
  return resources.map((resource) => {
    if (resource.type !== "cloudflare.worker") return resource;
    const properties = object(resource.properties);
    const owned = classes.get(resource.id) ?? [];
    const entrypoints = properties.entrypoints;
    if (Array.isArray(entrypoints) && owned.some((name) => entrypoints.includes(name)))
      throw new Error("Workflow and RPC entrypoints must have different names.");
    return {
      ...resource,
      ...(owned.length
        ? { protection: { data: true, allowDelete: resource.protection?.allowDelete ?? false } }
        : {}),
      properties: { ...properties, workflowClasses: [...new Set(owned)].sort() },
    };
  });
};
