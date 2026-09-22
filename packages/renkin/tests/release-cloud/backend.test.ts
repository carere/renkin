import { expect, it } from "vitest";
import { removeGraphBackend } from "#test-support/root/cloud-full-graph/backend.ts";

it("removes only the verified generated backend and audits every namespace page", async () => {
  const paths: string[] = [];
  let removed = false;
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    paths.push(`${request.method} ${url.pathname}${url.search}`);
    if (request.method === "DELETE") {
      removed = true;
      return Response.json({ success: true });
    }
    if (url.pathname.endsWith("/settings"))
      return removed
        ? new Response(null, { status: 404 })
        : Response.json({
            result: {
              tags: ["renkin-state-v2"],
              bindings: [{ name: "ACCOUNT_ID", text: "account" }],
            },
          });
    return Response.json({
      result:
        url.searchParams.get("page") === "1"
          ? Array.from({ length: 100 }, () => ({ script: "other" }))
          : [],
      result_info: { total_pages: 2 },
    });
  };
  await removeGraphBackend("renkin-test-graph-1234abcd", "account", "test-token", transport);
  expect(paths.filter((path) => path.startsWith("DELETE"))).toEqual([
    "DELETE /client/v4/accounts/account/workers/scripts/renkin-test-graph-1234abcd-state?force=true",
  ]);
  expect(paths.at(-1)).toContain("per_page=100&page=2");
});

it("preserves canonical or unverified backends", async () => {
  const methods: string[] = [];
  const transport: typeof fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return Response.json({ result: { tags: ["not-owned"] } });
  };
  await expect(
    removeGraphBackend("renkin-test-state-v2", "account", "test-token", transport),
  ).rejects.toThrow("generated");
  expect(methods).toEqual([]);
  await expect(
    removeGraphBackend("renkin-test-graph-1234abcd", "account", "test-token", transport),
  ).rejects.toThrow("preserved");
  expect(methods).toEqual(["GET"]);
});
