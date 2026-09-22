# Solid SPA example

Executable TanStack Start validation application using only public Renkin entry
points. Run `bun x --no-install renkin dev --file renkin.ts` in this directory
and open `http://127.0.0.1:3101`. Local development needs no Cloudflare credentials.

Click the counter, navigate to Details, and edit its heading to see Vite reload.
The native `/api/counter` route stores a value in KV; POST increments it and GET
reads it. The SPA build is exercised by the browser integration test.

Run `bun x --no-install vitest run --project integration` here, or the owning Moon
task from the workspace root. Install Chromium first with
`bun x playwright install chromium`. The test calls Renkin in Bun and verifies
both development and built native workerd execution.

See [TanStack sites](../../docs/agents/tanstack-sites.md) for options and cloud validation.
`src/routeTree.gen.ts` is owned by the official TanStack Router generator and is
excluded from manual formatting. The Vite polling flag is only for deterministic
source-reload tests in environments without native filesystem notifications.
