import { expect, it } from "@effect/vitest";
import { checkPrerenderResponse } from "../../../../src/contexts/root/services/astro/checked-prerender.ts";

it("rejects preview transport error pages before they can become static assets", async () => {
  for (const status of [500, 502, 503]) {
    const response = new Response("private transport failure details", { status });
    await expect(checkPrerenderResponse(response)).rejects.toThrow(
      `Astro prerender failed with HTTP ${status}.`,
    );
    expect(response.bodyUsed).toBe(true);
  }
});

it("preserves successful response streams and framed metadata", async () => {
  const result = { response: new Response("workerd page"), metadata: { contentEntryKeys: [] } };
  expect(await checkPrerenderResponse(result)).toBe(result);
  expect(result.response.bodyUsed).toBe(false);
  expect(await result.response.text()).toBe("workerd page");
});
