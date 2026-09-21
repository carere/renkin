import { worker as resource } from "@renkin/cloudflare/models/worker";
export const worker = resource;

import { kv as namespace } from "@renkin/cloudflare/models/kv";
export const kv = namespace;

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
