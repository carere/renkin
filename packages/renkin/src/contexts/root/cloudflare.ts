import { worker as resource } from "@renkin/cloudflare/models/worker";
export const worker = resource;

import { kv as namespace } from "@renkin/cloudflare/models/kv";
export const kv = namespace;

import { email as emailBinding } from "@renkin/cloudflare/models/email";
import { queue as queueResource } from "@renkin/cloudflare/models/queue";
import { workflow as workflowResource } from "@renkin/cloudflare/models/workflow";
export const queue = queueResource;
export const workflow = workflowResource;
export const email = emailBinding;

import {
  accessApplication as application,
  accessPolicy as policy,
  accessServiceToken as serviceToken,
} from "@renkin/cloudflare/models/access";
import {
  observabilityDestination as destination,
  customDomain as domain,
} from "@renkin/cloudflare/models/site";
export const accessApplication = application;
export const accessPolicy = policy;
export const accessServiceToken = serviceToken;
export const customDomain = domain;
export const observabilityDestination = destination;

import { d1 as database } from "@renkin/cloudflare/models/d1";
export const d1 = database;

import { durableObject as objectNamespace } from "@renkin/cloudflare/models/durable-object";
export const durableObject = objectNamespace;

import { r2 as bucket } from "@renkin/cloudflare/models/r2";
export const r2 = bucket;

import { r2Token as bucketToken } from "@renkin/cloudflare/models/r2-token";
export const r2Token = bucketToken;

import { astro as astroSite } from "@renkin/websites/models/astro";
export const astro = astroSite;
