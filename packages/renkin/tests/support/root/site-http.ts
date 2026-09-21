import { get as httpsGet } from "node:https";
// Node fetch rewrites Sec-Fetch-Mode to cors. HTTPS preserves the browser navigation header.
export const navigation = (url: string, headers: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    const request = httpsGet(
      url,
      { headers: { ...headers, "Sec-Fetch-Mode": "navigate", Accept: "text/html" } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(Buffer.concat(chunks).toString()));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.setTimeout(10000, () => request.destroy(new Error("Navigation request timed out.")));
  });

export const traceStateCalls = () => {
  const original = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/v1/")) return original(request);
    const payload = (request.body ? await request.clone().json() : {}) as {
      state?: string;
      request?: { path?: string };
    };
    const response = await original(request);
    const snapshot = payload.state
      ? (JSON.parse(payload.state) as { pending?: { phase?: string; change?: { id?: string } } })
      : undefined;
    events.push(
      `${path}:${response.status}:${snapshot?.pending?.change?.id ?? ""}:${snapshot?.pending?.phase ?? ""}:${payload.request?.path ?? ""}`,
    );
    if (events.length > 15) events.shift();
    return response;
  };
  return {
    events,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

export const closedTransport = (error: unknown) =>
  error instanceof TypeError &&
  error.cause instanceof Error &&
  "code" in error.cause &&
  ["ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE", "ENOTFOUND"].includes(String(error.cause.code));
export const siteFetch = async (url: string, init: RequestInit = {}) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (!closedTransport(error) || attempt >= 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};
