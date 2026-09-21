/** Preview authentication can succeed before a newly enabled workers.dev route is available. */
export const waitForStateEndpoint = async (
  input: { readonly endpoint: string; readonly stateAuthToken: string; readonly accountId: string },
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${input.endpoint}/v1/identity`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.stateAuthToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now()))),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      const remaining = deadline - Date.now();
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
      // A shortened final sleep cannot fund another retry, even if the timer wakes early.
      if (remaining <= 500) break;
      continue;
    }
    if (!response.ok) throw new Error("State endpoint readiness was rejected.");
    const identity: unknown = await response.json();
    if (
      !identity ||
      typeof identity !== "object" ||
      !("protocol" in identity) ||
      identity.protocol !== 1 ||
      !("accountId" in identity) ||
      identity.accountId !== input.accountId
    )
      throw new Error("State endpoint identity does not match the account.");
    return;
  }
  throw new Error("State endpoint routing did not become ready before the deadline.");
};
