#!/usr/bin/env node
// `pnpm test:e2e:sync [--allow-planned] [playwright args]`: the Sync lane
// (issue #222). Guard, typecheck, sync server fetch, web build, then a fresh
// PocketBase with the maibuk-sync migrations for this run only and the web
// build on a free port, Playwright against both (e2e/playwright.sync.config.ts),
// and both stopped and the data deleted however the run ends: pass, fail,
// Ctrl+C, or a crash. What a runner killed outright (SIGKILL) leaves is swept
// by the next run. Never part of
// `pnpm test:e2e`, never in CI. Args pass to `playwright test`.

import { fetchSyncServer } from "../scripts/fetch-sync-server.mjs";
import { startPreview, ownTeardown, runPlaywright } from "./preview-server.mjs";
import { buildWeb, preflight, root, wallClock } from "./run-steps.mjs";
import { startSyncServer, sweepStaleRuns } from "./sync-server.mjs";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const allowPlanned = argv.includes("--allow-planned");
const args = argv.filter((a) => a !== "--allow-planned");
const started = Date.now();

preflight({ allowPlanned });

console.log("\n[e2e] sync server (PocketBase + maibuk-sync migrations)");
await fetchSyncServer(root);

buildWeb();

const swept = sweepStaleRuns(root);
if (swept > 0) console.log(`[e2e] removed ${swept} sync server run(s) a killed run left behind`);

const server = await startSyncServer(root);
console.log(`[e2e] sync server up at ${server.url}`);
let preview = null;
// Last resort: whatever ends the process, both servers and the data go with it.
const teardown = ownTeardown(() => {
  preview?.stopSync();
  server.stopSync();
});
try {
  preview = await startPreview(root, server.runDir);
} catch (error) {
  console.error(`[e2e] ${error.message}`);
  await server.stop();
  process.exit(1);
}
console.log(`[e2e] web build served at ${preview.url}`);

const code = await runPlaywright({
  root,
  label: "playwright (sync lane)",
  config: "e2e/playwright.sync.config.ts",
  args,
  env: {
    E2E_SYNC_BASE_URL: preview.url,
    E2E_SYNC_URL: server.url,
    E2E_SYNC_SUPERUSER_EMAIL: server.superuser.email,
    E2E_SYNC_SUPERUSER_PASSWORD: server.superuser.password,
  },
  teardown,
});

await preview.stop();
await server.stop();
console.log("[e2e] web server and sync server stopped, data deleted");
if (code !== 0) console.error(`[e2e] playwright (sync lane) failed (exit ${code})`);
wallClock(started);
process.exit(code);
