// The local sync server for the E2E Sync lane (issue #222): PocketBase with
// the maibuk-sync migrations, on a free port, with a data directory of its
// own that is deleted when the server stops. run-sync.mjs owns the process;
// nothing here prints a password, a token, or note content.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { syncServerPaths } from "../scripts/fetch-sync-server.mjs";
import { OWNER_PID, freePort, readPid, sweepRunDirs } from "./preview-server.mjs";

/** Every run directory lives here, named after the runner's pid. */
export const RUNS_DIR = "e2e/.output/sync-server";
const SERVER_PID = "pocketbase.pid";
const READY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;

/**
 * Removes what an earlier Sync lane run left behind when its runner died
 * without cleaning up: its PocketBase (only if the pid still is PocketBase),
 * its web server, and its data directory. Returns how many runs it removed.
 */
export function sweepStaleRuns(root) {
  return sweepRunDirs(join(root, RUNS_DIR), {
    onStale: (dir, probe) => {
      const server = readPid(join(dir, SERVER_PID));
      if (server !== null && probe.runs(server, /pocketbase/i)) probe.kill(server, "SIGKILL");
    },
  });
}

async function waitForHealth(url, child, logFile) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8").slice(-2000) : "";
  throw new Error(
    `PocketBase did not become healthy at ${url} (exit ${child.exitCode ?? "none"})\n${log}`
  );
}

/**
 * Starts PocketBase with a fresh data directory and one superuser. Returns its
 * URL, the superuser's credentials (for seeding accounts through the admin
 * API), and `stop`, which kills the process and deletes the directory.
 * `stopSync` does the same without waiting, for an `exit` handler.
 */
export async function startSyncServer(root) {
  const { binary, migrationsDir } = syncServerPaths(root);
  if (!existsSync(binary) || !existsSync(migrationsDir)) {
    throw new Error("Sync server not fetched; run `pnpm fetch:sync-server`");
  }
  const runDir = join(root, RUNS_DIR, `run-${process.pid}`);
  rmSync(runDir, { recursive: true, force: true });
  const dataDir = join(runDir, "pb_data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(runDir, OWNER_PID), String(process.pid));

  const common = [`--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`];
  const superuser = {
    email: "superuser@maibuk.test",
    password: randomBytes(18).toString("base64url"),
  };
  // The upsert applies the system and maibuk-sync migrations before serve.
  execFileSync(binary, ["superuser", "upsert", superuser.email, superuser.password, ...common], {
    stdio: "ignore",
  });

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logFile = join(runDir, "pocketbase.log");
  const log = openSync(logFile, "w");
  const child = spawn(binary, ["serve", `--http=127.0.0.1:${port}`, ...common], {
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  writeFileSync(join(runDir, SERVER_PID), String(child.pid));

  let stopped = false;
  const stopSync = () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(runDir, { recursive: true, force: true });
  };
  const stop = async () => {
    if (stopped) return;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
      await exited;
      clearTimeout(timer);
    }
    stopSync();
  };

  try {
    await waitForHealth(url, child, logFile);
  } catch (error) {
    stopSync();
    throw error;
  }
  return { url, superuser, runDir, pid: child.pid, stop, stopSync };
}
