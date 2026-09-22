import { decodeState } from "@renkin/core/models/state";
import { assertEmptyState } from "@renkin/core/services/state/empty-state";
import { ChunkedStateStorage } from "./chunked-state-storage.ts";
import {
  acknowledgesReceipt,
  type MutationReceipt,
  receiptAcknowledgements,
  receiptIntent,
  receiptRequest,
} from "./mutation-receipts.ts";
import { type ReconciliationReceipt, summarizeOperation, validDecision } from "./reconciliation.ts";
import { authenticatesStateToken } from "./state-authentication.ts";
import { decryptState, encryptState, newStateKey } from "./state-cipher.ts";
import { type CoordinatorRequest, encodeBytes, type GatewayResponse } from "./state-protocol.ts";
import {
  prepareWorkerOperation,
  type WorkerOperation,
  workerOperationCompleted,
} from "./worker-operation.ts";

interface Sql {
  exec<T>(query: string, ...bindings: (string | number)[]): { toArray(): T[] };
}
interface Context {
  readonly storage: {
    readonly sql: Sql;
    sync(): Promise<void>;
    transactionSync<T>(callback: () => T): T;
  };
}
interface CoordinatorEnvironment {
  readonly ACCOUNT_ID: string;
  readonly RENKIN_STATE_AUTH?: string;
  readonly STATE_COORDINATOR: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}
interface Lease {
  readonly token: string;
  readonly expires: number;
  readonly epoch: number;
}
const leaseDuration = 60_000;
const response = (value: unknown, status = 200) => Response.json(value, { status });

/** One coordinator per stack; each environment has an independent lease and journal. */
export class StateCoordinator {
  private readonly activeDispatches = new Set<string>();
  private readonly stateStorage: ChunkedStateStorage;
  constructor(
    private readonly ctx: Context,
    private readonly env: CoordinatorEnvironment,
  ) {
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    this.stateStorage = new ChunkedStateStorage(ctx.storage.sql);
    // Synchronous insert-if-absent makes concurrent bootstrap select exactly one random key.
    ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO records VALUES ('encryption-key', ?)",
      newStateKey(),
    );
  }
  private get<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM records WHERE key = ?", key)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  private put(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO records VALUES (?, ?)",
      key,
      JSON.stringify(value),
    );
  }
  private remove(key: string): void {
    this.ctx.storage.sql.exec("DELETE FROM records WHERE key = ?", key);
  }
  private valid(environment: string, token?: string): boolean {
    const lease = this.get<Lease>(`lease:${environment}`);
    return !!lease && lease.token === token && lease.expires > Date.now();
  }
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handle(request);
    } catch {
      return response({ error: "State is unreadable or the provider outcome is unknown." }, 502);
    }
  }
  private async handle(request: Request): Promise<Response> {
    const input = (await request.json()) as CoordinatorRequest;
    if (!input.stack || typeof input.stack !== "string")
      return response({ error: "Invalid stack." }, 400);
    const action = new URL(request.url).pathname.split("/").at(-1);
    if (action === "list") {
      const rows = this.ctx.storage.sql
        .exec<{ key: string }>("SELECT key FROM records WHERE key LIKE 'state:%'")
        .toArray();
      return response(rows.map((row) => row.key.slice(6)));
    }
    const environment = input.environment;
    if (!environment || typeof environment !== "string")
      return response({ error: "Invalid environment." }, 400);
    const context = JSON.stringify([1, input.stack, environment]);
    // Key material stays in DO storage and is never exposed through the state API.
    const key = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM records WHERE key = 'encryption-key'")
      .toArray()[0]?.value;
    if (!key) return response({ error: "Encryption key is unavailable." }, 502);
    if (action === "read") {
      const encrypted = this.stateStorage.read(environment);
      return response(encrypted === undefined ? null : await decryptState(key, context, encrypted));
    }
    if (action === "inspect") return this.inspect(input.stack, environment, key);
    if (action === "reconcile") return this.acceptDecision(input, environment, key);
    if (action === "acquire") return this.acquire(request, environment);
    if (!this.valid(environment, input.token))
      return response({ error: "Deployment lease expired or belongs to another process." }, 409);
    if (action === "renew") {
      const lease = this.get<Lease>(`lease:${environment}`);
      this.put(`lease:${environment}`, { ...lease, expires: Date.now() + leaseDuration });
      return response(null);
    }
    if (action === "release") {
      await this.reconcile(environment, request.headers.get("authorization") ?? "");
      if (!this.valid(environment, input.token) || this.get(`operation:${environment}`))
        return response({ error: "Provider operation remains unresolved or lease expired." }, 409);
      this.remove(`lease:${environment}`);
      return response(null);
    }
    if (action === "remove-empty") return this.removeEmpty(input, environment, key, context);
    if (action === "write") {
      return this.writeState(input, environment, key, context);
    }
    if (action === "mutate") return this.mutate(request, input, environment);
    return response({ error: "Unknown operation." }, 404);
  }
  private async removeEmpty(
    input: CoordinatorRequest,
    environment: string,
    key: string,
    context: string,
  ): Promise<Response> {
    const encrypted = this.stateStorage.read(environment);
    const current =
      encrypted === undefined
        ? undefined
        : decodeState(await decryptState(key, context, encrypted), input.stack, environment);
    assertEmptyState(current);
    const removed = this.ctx.storage.transactionSync(() => {
      if (
        !this.valid(environment, input.token) ||
        this.get(`operation:${environment}`) ||
        this.stateStorage.read(environment) !== encrypted
      )
        return false;
      const receipts = this.ctx.storage.sql
        .exec<{ key: string }>(
          "SELECT key FROM records WHERE substr(key, 1, ?) = ?",
          `receipt:${environment}:`.length,
          `receipt:${environment}:`,
        )
        .toArray();
      if (receipts.length) return false;
      this.stateStorage.remove(environment);
      this.remove(`lease:${environment}`);
      return true;
    });
    return removed
      ? response(null)
      : response({ error: "Environment changed or still has unfinished operations." }, 409);
  }
  private async writeState(
    input: CoordinatorRequest,
    environment: string,
    key: string,
    context: string,
  ): Promise<Response> {
    if (typeof input.state !== "string") return response({ error: "Invalid state." }, 400);
    const encrypted = await encryptState(key, context, input.state);
    const acknowledged: string[] = [];
    for (const candidate of receiptAcknowledgements(input.state)) {
      const receiptKey = `receipt:${environment}:${candidate.key}`;
      const saved = this.get<string>(receiptKey);
      if (!saved) continue;
      const receipt = JSON.parse(
        await decryptState(key, JSON.stringify([1, input.stack, environment, receiptKey]), saved),
      ) as MutationReceipt;
      if (acknowledgesReceipt(candidate.resource, receipt)) acknowledged.push(receiptKey);
    }
    if (!this.valid(environment, input.token))
      return response({ error: "Deployment lease expired." }, 409);
    this.ctx.storage.transactionSync(() => {
      this.stateStorage.write(environment, encrypted);
      for (const receiptKey of acknowledged) this.remove(receiptKey);
    });
    return response(null);
  }
  private async inspect(stack: string, environment: string, key: string): Promise<Response> {
    const rows = this.ctx.storage.sql
      .exec<{ key: string; value: string }>(
        "SELECT key, value FROM records WHERE substr(key, 1, ?) = ? ORDER BY key",
        `audit:${environment}:`.length,
        `audit:${environment}:`,
      )
      .toArray();
    const audit = await Promise.all(
      rows.map(
        async (row) =>
          JSON.parse(
            await decryptState(
              key,
              JSON.stringify([1, stack, environment, row.key]),
              JSON.parse(row.value) as string,
            ),
          ) as ReconciliationReceipt,
      ),
    );
    const operation = this.get<WorkerOperation>(`operation:${environment}`);
    const lease = this.get<Lease>(`lease:${environment}`);
    return response({
      operation: operation ? summarizeOperation(operation) : null,
      coordinatorActive: !!operation && this.activeDispatches.has(operation.id),
      leaseActive: !!lease && lease.expires > Date.now(),
      leaseExpiresAt: lease ? new Date(lease.expires).toISOString() : null,
      audit,
    });
  }
  private canReconcile(environment: string, operationId: string): boolean {
    return (
      this.get<WorkerOperation>(`operation:${environment}`)?.id === operationId &&
      !this.activeDispatches.has(operationId) &&
      (this.get<Lease>(`lease:${environment}`)?.expires ?? 0) <= Date.now()
    );
  }
  private async acceptDecision(
    input: CoordinatorRequest,
    environment: string,
    key: string,
  ): Promise<Response> {
    const decision = input.decision;
    if (!validDecision(decision))
      return response(
        {
          error:
            "Exact operation, outcome, operator, evidence and provider settlement assertion are required.",
        },
        400,
      );
    if (!this.canReconcile(environment, decision.operationId))
      return response(
        { error: "Operation changed, lease is live or coordinator dispatch is still active." },
        409,
      );
    const operation = this.get<WorkerOperation>(`operation:${environment}`);
    if (!operation) return response({ error: "Operation is no longer pending." }, 409);
    const epoch = (this.get<number>(`epoch:${environment}`) ?? 0) + 1;
    const receipt: ReconciliationReceipt = {
      ...summarizeOperation(operation),
      outcome: decision.outcome,
      operator: decision.operator.trim(),
      evidence: decision.evidence.trim(),
      reconciledAt: new Date().toISOString(),
      epoch,
    };
    const auditKey = `audit:${environment}:${operation.id}`;
    const encrypted = await encryptState(
      key,
      JSON.stringify([1, input.stack, environment, auditKey]),
      JSON.stringify(receipt),
    );
    const applied = this.ctx.storage.transactionSync(() => {
      if (!this.canReconcile(environment, operation.id)) return false;
      this.put(auditKey, encrypted);
      this.put(`epoch:${environment}`, epoch);
      this.remove(`lease:${environment}`);
      this.remove(`operation:${environment}`);
      return true;
    });
    if (!applied)
      return response({ error: "Operation changed while recording reconciliation." }, 409);
    return response(receipt);
  }
  private async reconcile(environment: string, authorization: string): Promise<void> {
    const pending = this.get<WorkerOperation>(`operation:${environment}`);
    if (
      pending &&
      !this.activeDispatches.has(pending.id) &&
      (await workerOperationCompleted(pending, authorization)) &&
      this.get<WorkerOperation>(`operation:${environment}`)?.id === pending.id &&
      !this.activeDispatches.has(pending.id)
    )
      this.remove(`operation:${environment}`);
  }
  private async acquire(request: Request, environment: string): Promise<Response> {
    if ((this.get<Lease>(`lease:${environment}`)?.expires ?? 0) > Date.now())
      return response({ error: "Environment is busy." }, 409);
    await this.reconcile(environment, request.headers.get("authorization") ?? "");
    if (
      (this.get<Lease>(`lease:${environment}`)?.expires ?? 0) > Date.now() ||
      this.get(`operation:${environment}`)
    )
      return response(
        {
          error:
            "Environment is busy or provider outcome remains ambiguous; retry after Cloudflare confirms completion.",
        },
        409,
      );
    const epoch = (this.get<number>(`epoch:${environment}`) ?? 0) + 1;
    const token = JSON.stringify({ owner: crypto.randomUUID(), epoch });
    this.put(`epoch:${environment}`, epoch);
    this.put(`lease:${environment}`, { token, epoch, expires: Date.now() + leaseDuration });
    return response({ token });
  }
  private async mutate(
    request: Request,
    input: CoordinatorRequest,
    environment: string,
  ): Promise<Response> {
    const mutation = input.request;
    if (!mutation || !["PUT", "POST", "PATCH", "DELETE"].includes(mutation.method))
      return response({ error: "Invalid mutation." }, 400);
    const path = mutation.path.startsWith("/accounts/")
      ? `/client/v4${mutation.path}`
      : mutation.path;
    const url = new URL(path, "https://api.cloudflare.com");
    if (
      url.origin !== "https://api.cloudflare.com" ||
      !url.pathname.startsWith(`/client/v4/accounts/${this.env.ACCOUNT_ID}/`)
    )
      return response({ error: "Mutation is outside the configured account." }, 403);
    if (this.get(`operation:${environment}`))
      return response({ error: "A provider operation is unresolved." }, 409);
    const assetUpload =
      url.pathname === `/client/v4/accounts/${this.env.ACCOUNT_ID}/workers/assets/upload`;
    if (
      (mutation.assetUploadToken !== undefined && !assetUpload) ||
      (assetUpload &&
        (mutation.method !== "POST" ||
          url.search !== "?base64=true" ||
          typeof mutation.assetUploadToken !== "string" ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(mutation.assetUploadToken)))
    )
      return response({ error: "Invalid asset upload authorization." }, 400);
    const receipt = await receiptRequest(mutation, this.env.ACCOUNT_ID);
    const pendingReceipt = receipt
      ? await this.prepareReceipt(input, environment, receipt)
      : undefined;
    if (pendingReceipt instanceof Response) return pendingReceipt;
    const prepared = await prepareWorkerOperation(
      url,
      mutation,
      request.headers.get("authorization") ?? "",
    );
    if (!this.valid(environment, input.token) || this.get(`operation:${environment}`))
      return response({ error: "Lease expired or operation is unresolved." }, 409);
    if (prepared.completedResult !== undefined)
      return response({
        status: 200,
        bodyBase64: encodeBytes(
          new TextEncoder().encode(
            JSON.stringify({ success: true, result: prepared.completedResult }),
          ),
        ),
        headers: { "content-type": "application/json" },
      });
    return this.dispatch(url, mutation.method, prepared, environment, input.stack, pendingReceipt);
  }
  private async prepareReceipt(
    input: CoordinatorRequest,
    environment: string,
    receipt: NonNullable<Awaited<ReturnType<typeof receiptRequest>>>,
  ): Promise<Omit<MutationReceipt, "result"> | Response> {
    const key = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM records WHERE key = 'encryption-key'")
      .toArray()[0]?.value;
    if (!key) throw new Error("Encryption key unavailable.");
    const savedState = this.stateStorage.read(environment);
    const resourceId = receiptIntent(
      savedState
        ? await decryptState(key, JSON.stringify([1, input.stack, environment]), savedState)
        : undefined,
      receipt.allocationId,
      receipt.resourceType,
    );

    const receiptKey = `receipt:${environment}:${receipt.operationKey}`;
    const saved = this.get<string>(receiptKey);
    if (saved) {
      const stored = JSON.parse(
        await decryptState(key, JSON.stringify([1, input.stack, environment, receiptKey]), saved),
      ) as MutationReceipt;
      if (stored.requestDigest !== receipt.requestDigest || stored.resourceId !== resourceId)
        return response({ error: "Mutation receipt does not match this request." }, 409);
      if (!this.valid(environment, input.token))
        return response({ error: "Deployment lease expired." }, 409);
      return response(stored.result);
    }
    if (input.request?.receiptOnly)
      return response({
        status: 200,
        headers: { "content-type": "application/json" },
        bodyBase64: encodeBytes(
          new TextEncoder().encode(JSON.stringify({ success: true, result: {} })),
        ),
      });
    return { ...receipt, resourceId };
  }
  private async dispatch(
    url: URL,
    method: string,
    prepared: Awaited<ReturnType<typeof prepareWorkerOperation>>,
    environment: string,
    stack: string,
    receipt?: Omit<MutationReceipt, "result">,
  ): Promise<Response> {
    this.put(`operation:${environment}`, prepared.operation);
    this.activeDispatches.add(prepared.operation.id);
    try {
      await this.ctx.storage.sync();
      // The persisted marker prevents takeover until dispatch completion is established.
      const upstream = await fetch(url, {
        method,
        headers: prepared.headers,
        redirect: "manual",
        ...(prepared.body === undefined ? {} : { body: prepared.body }),
      });
      const result: GatewayResponse = {
        status: upstream.status,
        bodyBase64: encodeBytes(new Uint8Array(await upstream.arrayBuffer())),
        headers: Object.fromEntries(upstream.headers),
      };
      let encryptedReceipt: string | undefined;
      const receiptKey = receipt ? `receipt:${environment}:${receipt.operationKey}` : undefined;
      if (receipt && receiptKey && upstream.status >= 200 && upstream.status < 300) {
        const key = this.ctx.storage.sql
          .exec<{ value: string }>("SELECT value FROM records WHERE key = 'encryption-key'")
          .toArray()[0]?.value;
        if (!key) throw new Error("Encryption key unavailable.");
        encryptedReceipt = await encryptState(
          key,
          JSON.stringify([1, stack, environment, receiptKey]),
          JSON.stringify({ ...receipt, result }),
        );
      }
      if (
        ((upstream.status >= 200 && upstream.status < 300) ||
          (upstream.status >= 400 && upstream.status < 500 && upstream.status !== 408)) &&
        this.get<WorkerOperation>(`operation:${environment}`)?.id === prepared.operation.id
      )
        this.ctx.storage.transactionSync(() => {
          if (encryptedReceipt && receiptKey) this.put(receiptKey, encryptedReceipt);
          this.remove(`operation:${environment}`);
        });
      return response(result);
    } finally {
      this.activeDispatches.delete(prepared.operation.id);
    }
  }
}

export default {
  async fetch(request: Request, env: CoordinatorEnvironment): Promise<Response> {
    if (request.method !== "POST") return response({ error: "POST required." }, 405);
    const authorization = request.headers.get("authorization");
    if (
      !env.RENKIN_STATE_AUTH ||
      !authorization?.startsWith("Bearer ") ||
      !(await authenticatesStateToken(env.RENKIN_STATE_AUTH, authorization.slice(7)))
    )
      return response({ error: "State authentication failed." }, 401);
    if (new URL(request.url).pathname === "/v1/identity")
      return response({ protocol: 1, accountId: env.ACCOUNT_ID });
    const input = (await request.clone().json()) as CoordinatorRequest;
    if (typeof input.stack !== "string" || !input.stack)
      return response({ error: "Invalid stack." }, 400);
    const apiToken = request.headers.get("x-renkin-cloudflare-token");
    if (!apiToken) return response({ error: "Cloudflare API token is required." }, 401);
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${apiToken}`);
    headers.delete("x-renkin-cloudflare-token");
    return env.STATE_COORDINATOR.get(env.STATE_COORDINATOR.idFromName(input.stack)).fetch(
      new Request(request, { headers }),
    );
  },
};
