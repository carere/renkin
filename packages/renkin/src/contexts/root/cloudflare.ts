import { worker as resource } from "@renkin/cloudflare/models/worker";
export const worker = resource;

import { kv as namespace } from "@renkin/cloudflare/models/kv";
export const kv = namespace;

import { d1 as database } from "@renkin/cloudflare/models/d1";
export const d1 = database;
