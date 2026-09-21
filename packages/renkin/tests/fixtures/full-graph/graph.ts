import { fileURLToPath } from "node:url";
import { defineStack } from "renkin";
import { d1, worker } from "renkin/cloudflare";
import { frontend } from "./frontends/config.ts";
import {
  Audit,
  Events,
  FailedOrders,
  Files,
  OrderFlow,
  PendingOrders,
  Sessions,
  UploadToken,
} from "./shared/resources.ts";

export const graph = (
  options: {
    readonly name?: string;
    readonly cron?: string;
    readonly notification?: { readonly from: string; readonly to: string };
  } = {},
) => {
  const service = (id: string, entry: string, extra = {}) =>
    worker(id, {
      entry: fileURLToPath(new URL(`./services/${entry}.ts`, import.meta.url)),
      compatibilityDate: "2026-07-30",
      ...extra,
    });
  return defineStack({
    name: options.name ?? "full-graph",
    resources: [
      Sessions,
      Audit,
      d1("Orders", { migrations: fileURLToPath(new URL("./migrations", import.meta.url)) }),
      Files,
      UploadToken,
      PendingOrders,
      FailedOrders,
      OrderFlow,
      Events,
      service("Auth", "auth"),
      service("API", "api"),
      service("Jobs", "jobs", {
        consumers: [
          {
            queue: PendingOrders,
            maxBatchTimeout: 0,
            maxRetries: 1,
            retryDelay: 0,
            deadLetterQueue: FailedOrders,
          },
        ],
      }),
      service("Notifications", "notifications", {
        consumers: [{ queue: FailedOrders, maxBatchTimeout: 0 }],
        bindings: {
          MAIL_FROM: options.notification?.from ?? "sender@example.com",
          MAIL_TO: options.notification?.to ?? "recipient@example.com",
        },
      }),
      service("Tracking", "tracking", { crons: [options.cron ?? "*/5 * * * *"] }),
      frontend("Console", "console", "spa"),
      frontend("CustomerHub", "customer-hub", "spa"),
      frontend("Storefront", "storefront", "ssr"),
    ],
  });
};
export default graph();
