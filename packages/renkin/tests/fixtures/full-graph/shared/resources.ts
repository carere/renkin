import { d1, durableObject, kv, queue, r2, r2Token, workflow } from "renkin/cloudflare";

export const Sessions = kv("Sessions");
export const Orders = d1("Orders");
export const Files = r2("Files");
export const Audit = kv("Audit");
export const PendingOrders = queue<{ id: string; poison?: boolean }>("PendingOrders");
export const FailedOrders = queue<{ id: string; poison?: boolean }>("FailedOrders");
export const OrderFlow = workflow("OrderFlow", { worker: "Jobs", className: "FulfillOrder" });
export const Events = durableObject("Events", { worker: "Tracking", className: "OrderEvents" });
// Development supplies separate opt-in credentials; no provider token is created locally.
export const UploadToken = r2Token("UploadToken", {
  buckets: [Files],
  permissions: "read-write",
  expiresAt: "2099-01-01T00:00:00Z",
});
