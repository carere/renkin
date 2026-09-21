import type { WorkerOperation } from "./worker-operation.ts";

export interface ReconciliationDecision {
  readonly operationId: string;
  readonly outcome: "completed" | "not-applied";
  /** A human identity/label, not an independently verified Cloudflare principal. */
  readonly operator: string;
  /** A support case, audit reference, or concise evidence reference; never credentials. */
  readonly evidence: string;
  readonly providerSettled: true;
}
export interface OperationSummary {
  readonly operationId: string;
  readonly method: string;
  readonly target: string;
  readonly tag?: string;
}
export interface ReconciliationReceipt extends OperationSummary {
  readonly outcome: ReconciliationDecision["outcome"];
  readonly operator: string;
  readonly evidence: string;
  readonly reconciledAt: string;
  readonly epoch: number;
}
export interface RecoveryInspection {
  readonly operation: OperationSummary | null;
  readonly coordinatorActive: boolean;
  readonly leaseExpiresAt: string | null;
  readonly leaseActive: boolean;
  readonly audit: readonly ReconciliationReceipt[];
}

export const summarizeOperation = (operation: WorkerOperation): OperationSummary => ({
  operationId: operation.id,
  method: operation.method,
  target: new URL(operation.path).pathname,
  ...(operation.tag ? { tag: operation.tag } : {}),
});

export const validDecision = (value: unknown): value is ReconciliationDecision => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.operationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.operationId) &&
    ["completed", "not-applied"].includes(String(record.outcome)) &&
    record.providerSettled === true &&
    typeof record.operator === "string" &&
    record.operator.trim().length > 0 &&
    record.operator.length <= 200 &&
    typeof record.evidence === "string" &&
    record.evidence.trim().length > 0 &&
    record.evidence.length <= 2000
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const validSummary = (value: unknown): value is OperationSummary =>
  isRecord(value) &&
  typeof value.operationId === "string" &&
  typeof value.method === "string" &&
  typeof value.target === "string" &&
  (value.tag === undefined || typeof value.tag === "string");
export const validReceipt = (value: unknown): value is ReconciliationReceipt =>
  validSummary(value) &&
  isRecord(value) &&
  ["completed", "not-applied"].includes(String(value.outcome)) &&
  typeof value.operator === "string" &&
  typeof value.evidence === "string" &&
  typeof value.reconciledAt === "string" &&
  Number.isFinite(Date.parse(value.reconciledAt)) &&
  typeof value.epoch === "number" &&
  Number.isSafeInteger(value.epoch) &&
  value.epoch > 0;
export const validInspection = (value: unknown): value is RecoveryInspection =>
  isRecord(value) &&
  (value.operation === null || validSummary(value.operation)) &&
  typeof value.coordinatorActive === "boolean" &&
  typeof value.leaseActive === "boolean" &&
  (value.leaseExpiresAt === null ||
    (typeof value.leaseExpiresAt === "string" &&
      Number.isFinite(Date.parse(value.leaseExpiresAt)))) &&
  Array.isArray(value.audit) &&
  value.audit.every(validReceipt);
