/** Preserve Request-as-init headers/body while bounding both SDK and coordinator traffic. */
export const boundRequests = () => {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    return original(request, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
    });
  };
  return () => {
    globalThis.fetch = original;
  };
};
