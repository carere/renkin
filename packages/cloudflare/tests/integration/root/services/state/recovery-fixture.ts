import worker, {
  StateCoordinator as Coordinator,
} from "#src/contexts/root/services/state/coordinator-worker.ts";

/** Test-only clock seam: expire durable leases without sleeping, preserving real encrypted storage. */
export class StateCoordinator extends Coordinator {
  constructor(
    private readonly context: ConstructorParameters<typeof Coordinator>[0],
    env: ConstructorParameters<typeof Coordinator>[1],
  ) {
    super(context, env);
  }
  override async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split("/").at(-1);
    if (action === "test-expire") {
      const { environment } = (await request.json()) as { environment: string };
      this.context.storage.sql.exec(
        "UPDATE records SET value = json_set(value, '$.expires', 0) WHERE key = ?",
        `lease:${environment}`,
      );
      return Response.json(null);
    }
    if (action === "test-raw")
      return Response.json(
        this.context.storage.sql.exec("SELECT key,value FROM records").toArray(),
      );
    if (action === "test-damage-chunk" || action === "test-legacy-state") {
      const { environment } = (await request.json()) as { environment: string };
      if (action === "test-damage-chunk")
        this.context.storage.sql.exec(
          "DELETE FROM state_chunks WHERE environment = ? AND part = 0",
          environment,
        );
      else {
        const chunks = this.context.storage.sql
          .exec<{ value: string }>(
            "SELECT value FROM state_chunks WHERE environment = ? ORDER BY part",
            environment,
          )
          .toArray();
        this.context.storage.sql.exec(
          "UPDATE records SET value = ? WHERE key = ?",
          JSON.stringify(chunks.map((chunk) => chunk.value).join("")),
          `state:${environment}`,
        );
        this.context.storage.sql.exec(
          "DELETE FROM state_chunks WHERE environment = ?",
          environment,
        );
      }
      return Response.json(null);
    }
    return super.fetch(request);
  }
}
export default worker;
