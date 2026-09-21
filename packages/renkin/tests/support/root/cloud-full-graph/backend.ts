type Provider = (path: string, method?: string) => Promise<Response>;
const assertNamespaceAbsent = async (provider: Provider, script: string) => {
  for (let page = 1; page <= 100; page++) {
    const response = await provider(
      `/workers/durable_objects/namespaces?per_page=100&page=${page}`,
    );
    if (!response.ok) throw new Error(`Namespace audit failed (${response.status}).`);
    const body = (await response.json()) as {
      result?: { script?: string }[];
      result_info?: { total_pages?: number };
    };
    if (!Array.isArray(body.result)) throw new Error("Namespace audit returned invalid data.");
    if (body.result.some((namespace) => namespace.script === script))
      throw new Error("The isolated graph backend namespace still exists.");
    if (body.result.length < 100 || page >= (body.result_info?.total_pages ?? Infinity)) return;
  }
  throw new Error("Namespace audit pagination exceeded its bounded scope.");
};

/** Call only after public application removal and environment absence have succeeded. */
export const removeGraphBackend = async (
  graphName: string,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
  apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "",
  transport: typeof fetch = fetch,
): Promise<void> => {
  if (!/^renkin-test-graph-[a-f0-9]{8}$/.test(graphName))
    throw new Error("Only the generated isolated graph backend may be removed.");
  const script = `${graphName}-state`;
  const provider: Provider = (path, method = "GET") =>
    transport(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  const settings = await provider(`/workers/scripts/${script}/settings`);
  if (settings.status !== 404) {
    if (!settings.ok) throw new Error(`Backend ownership inspection failed (${settings.status}).`);
    const body = (await settings.json()) as {
      result?: { tags?: string[]; bindings?: { name?: string; text?: string }[] };
    };
    if (
      !body.result?.tags?.includes("renkin-state-v2") ||
      !body.result.bindings?.some(
        (binding) => binding.name === "ACCOUNT_ID" && binding.text === accountId,
      )
    )
      throw new Error("Isolated backend ownership was not verified; backend preserved.");
    const removed = await provider(`/workers/scripts/${script}?force=true`, "DELETE");
    if (!removed.ok) throw new Error(`Isolated backend removal failed (${removed.status}).`);
    await removed.text();
  } else await settings.text();
  const absent = await provider(`/workers/scripts/${script}/settings`);
  if (absent.status !== 404) throw new Error("The isolated graph backend still exists.");
  await absent.text();
  await assertNamespaceAbsent(provider, script);
};
