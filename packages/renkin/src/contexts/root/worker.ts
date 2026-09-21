import { defineWorker as implementation } from "@renkin/runtime/models/worker";
/** Define the handler once; resource declarations supply deployment settings separately. */
export const defineWorker = implementation;

import {
  externalWorker as external,
  workerReference as reference,
} from "@renkin/runtime/models/binding";
export const workerReference = reference;
export const externalWorker = external;

import { localS3Endpoint as endpoint } from "@renkin/runtime/models/local-r2-s3";
export const localS3Endpoint = endpoint;
