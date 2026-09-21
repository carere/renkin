import { build } from "esbuild";
import { type Request as EmulatorRequest, Miniflare, Response } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

let emulator: Miniflare;
let coordinatorScript: string;
const stateAuthToken = "independent-state-auth-secret";
let acceptedTags: string[] = [];
let subdomainEnabled = false;
beforeAll(async () => {
  const bundle = await build({
    entryPoints: [
      new URL(
        "../../../../../src/contexts/root/services/state/coordinator-worker.ts",
        import.meta.url,
      ).pathname,
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  coordinatorScript = bundle.outputFiles[0]?.text ?? "";
  emulator = new Miniflare({
    modules: true,
    script: coordinatorScript,
    compatibilityDate: "2026-08-01",
    bindings: { ACCOUNT_ID: "test-account", RENKIN_STATE_AUTH: stateAuthToken },
    durableObjects: { STATE_COORDINATOR: { className: "StateCoordinator", useSQLite: true } },
    outboundService: async (request: EmulatorRequest) => {
      expect(request.headers.get("authorization")).toMatch(/^Bearer valid-[ab]$/);
      expect(request.headers.get("x-renkin-cloudflare-token")).toBeNull();
      expect(request.headers.get("authorization")).not.toContain(stateAuthToken);
      const path = new URL(request.url).pathname;
      if (path.includes("invalid-route"))
        return Response.json({ errors: [{ code: 7003 }] }, { status: 404 });
      if (path.includes("already-missing"))
        return Response.json({ errors: [{ code: 10007 }] }, { status: 404 });
      if (path.endsWith("/subdomain")) {
        if (request.method === "POST") {
          subdomainEnabled = ((await request.json()) as { enabled: boolean }).enabled;
          return new Response("response lost after acceptance", { status: 503 });
        }
        return Response.json({ result: { enabled: subdomainEnabled } });
      }
      if (request.method === "PUT") {
        const form = await request.formData();
        const metadata = JSON.parse(String(form.get("metadata"))) as { tags: string[] };
        acceptedTags = metadata.tags;
        return new Response("response lost after acceptance", { status: 503 });
      }
      if (new URL(request.url).pathname.endsWith("/settings"))
        return Response.json({ result: { tags: acceptedTags } });
      return Response.json({ success: true });
    },
  });
});
afterAll(async () => {
  await emulator.dispose();
});
const call = async (action: string, input: Record<string, unknown>, token = "valid-a") => {
  return emulator.dispatchFetch(`https://state.example/v1/${action}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${stateAuthToken}`,
      "x-renkin-cloudflare-token": token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ stack: "stack", environment: "preview", ...input }),
  });
};
it("shares authenticated encrypted state across clients and rejects stale fencing", async () => {
  const initial = await call("read", {});
  expect(await initial.text()).toBe("null");
  const lease = (await (await call("acquire", {})).json()) as { token: string };
  expect((await call("acquire", {})).status).toBe(409);
  expect((await call("acquire", { environment: "another" })).status).toBe(200);
  expect((await call("write", { token: lease.token, state: '{"secret":"stored"}' })).status).toBe(
    200,
  );
  expect(await (await call("read", {}, "valid-b")).json()).toBe('{"secret":"stored"}');
  expect(await (await call("list", {})).json()).toEqual(["preview"]);
  expect((await call("release", { token: lease.token })).status).toBe(200);
  const next = (await (await call("acquire", {})).json()) as { token: string };
  expect(next.token).not.toBe(lease.token);
  expect((await call("write", { token: lease.token, state: "stale" })).status).toBe(409);
  expect(
    (
      await call("mutate", {
        token: lease.token,
        request: { method: "PUT", path: "/client/v4/accounts/test-account/workers/scripts/test" },
      })
    ).status,
  ).toBe(409);
  expect((await call("release", { token: lease.token })).status).toBe(409);
  expect(
    (
      await call("mutate", {
        token: next.token,
        request: { method: "PUT", path: "https://evil.example/" },
      })
    ).status,
  ).toBe(403);
});

it("rejects unauthenticated state access", async () => {
  const result = await emulator.dispatchFetch("https://state.example/v1/read", {
    method: "POST",
    body: "{}",
  });
  expect(result.status).toBe(401);
});

it("reconciles an accepted Worker upload when the dispatch response was lost", async () => {
  const environment = "recover";
  const lease = (await (await call("acquire", { environment })).json()) as { token: string };
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "index.js", tags: ["owned"] }));
  form.set("index.js", new Blob(["export default {}"]), "index.js");
  const upload = new Request("https://example.test", { method: "PUT", body: form });
  const mutation = await call("mutate", {
    environment,
    token: lease.token,
    request: {
      method: "PUT",
      path: "/accounts/test-account/workers/scripts/recover",
      headers: { "content-type": upload.headers.get("content-type") },
      bodyBase64: Buffer.from(await upload.arrayBuffer()).toString("base64"),
    },
  });
  expect(((await mutation.json()) as { status: number }).status).toBe(503);
  expect(acceptedTags).toContain("owned");
  expect(acceptedTags.some((tag) => tag.startsWith("renkin-operation:"))).toBe(true);
  // Release also reconciles, exercising persisted dispatch recovery without a minute-long lease wait.
  expect((await call("release", { environment, token: lease.token })).status).toBe(200);
  expect((await call("acquire", { environment })).status).toBe(200);
});

it("recovers a crashed lease holder after its accepted upload and fences the old holder", async () => {
  const environment = "crashed";
  const lease = (await (await call("acquire", { environment })).json()) as { token: string };
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "index.js" }));
  form.set("index.js", new Blob(["export default {}"]), "index.js");
  const upload = new Request("https://example.test", { method: "PUT", body: form });
  await call("mutate", {
    environment,
    token: lease.token,
    request: {
      method: "PUT",
      path: "/accounts/test-account/workers/scripts/crashed",
      headers: { "content-type": upload.headers.get("content-type") },
      bodyBase64: Buffer.from(await upload.arrayBuffer()).toString("base64"),
    },
  });
  // A stopped client cannot release or renew. Exercise the real server lease deadline.
  await new Promise((resolve) => setTimeout(resolve, 60_100));
  expect((await call("acquire", { environment })).status).toBe(200);
  expect((await call("renew", { environment, token: lease.token })).status).toBe(409);
  expect(
    (
      await call("mutate", {
        environment,
        token: lease.token,
        request: { method: "DELETE", path: "/accounts/test-account/workers/scripts/crashed" },
      })
    ).status,
  ).toBe(409);
}, 75_000);

it("recovers subdomain configuration and skips an already-applied duplicate", async () => {
  const environment = "subdomain";
  const lease = (await (await call("acquire", { environment })).json()) as { token: string };
  const request = {
    method: "POST",
    path: "/accounts/test-account/workers/scripts/worker/subdomain",
    headers: { "content-type": "application/json" },
    bodyBase64: Buffer.from(JSON.stringify({ enabled: true })).toString("base64"),
  };
  expect(
    (
      (await (await call("mutate", { environment, token: lease.token, request })).json()) as {
        status: number;
      }
    ).status,
  ).toBe(503);
  expect((await call("release", { environment, token: lease.token })).status).toBe(200);
  const next = (await (await call("acquire", { environment })).json()) as { token: string };
  expect(
    (
      (await (await call("mutate", { environment, token: next.token, request })).json()) as {
        status: number;
      }
    ).status,
  ).toBe(200);
});
it("treats only WorkerNotFound as absence before delete", async () => {
  const environment = "delete-errors";
  const lease = (await (await call("acquire", { environment })).json()) as { token: string };
  expect(
    (
      await call("mutate", {
        environment,
        token: lease.token,
        request: { method: "DELETE", path: "/accounts/test-account/workers/scripts/invalid-route" },
      })
    ).status,
  ).toBe(502);
  expect(
    (
      await call("mutate", {
        environment,
        token: lease.token,
        request: {
          method: "DELETE",
          path: "/accounts/test-account/workers/scripts/already-missing",
        },
      })
    ).status,
  ).toBe(200);
});

it("rejects account-read credentials as the state bearer", async () => {
  const environment = "auth-protection";
  const lease = (await (await call("acquire", { environment })).json()) as { token: string };
  await call("write", { environment, token: lease.token, state: "protected-state" });
  for (const action of ["read", "write", "identity"]) {
    const result = await emulator.dispatchFetch(`https://state.example/v1/${action}`, {
      method: "POST",
      headers: {
        authorization: "Bearer account-settings-read-token",
        "x-renkin-cloudflare-token": "valid-a",
      },
      body: JSON.stringify({ stack: "stack", environment, state: "corrupt" }),
    });
    expect(result.status).toBe(401);
  }
  expect(await (await call("read", { environment })).json()).toBe("protected-state");
});
it("fails closed when the state auth secret binding is missing", async () => {
  const unconfigured = new Miniflare({
    modules: true,
    script: coordinatorScript,
    compatibilityDate: "2026-08-01",
    bindings: { ACCOUNT_ID: "test-account" },
    durableObjects: { STATE_COORDINATOR: { className: "StateCoordinator", useSQLite: true } },
  });
  try {
    const result = await unconfigured.dispatchFetch("https://state.example/v1/identity", {
      method: "POST",
      headers: { authorization: `Bearer ${stateAuthToken}` },
      body: "{}",
    });
    expect(result.status).toBe(401);
  } finally {
    await unconfigured.dispose();
  }
});
