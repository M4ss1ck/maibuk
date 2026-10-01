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
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { syncServerPaths } from "../scripts/fetch-sync-server.mjs";

/** Every run directory lives here, named after the runner's pid. */
export const RUNS_DIR = "e2e/.output/sync-server";
const OWNER_PID = "owner.pid";
const SERVER_PID = "pocketbase.pid";
const PREVIEW_PID = "preview.pid";
const READY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, owned by someone else.
    return error.code === "EPERM";
  }
}

/** Whether `pid` still runs `pattern` (PocketBase, vite preview), so a recycled pid is never killed. */
function runs(pid, pattern) {
  if (!isAlive(pid)) return false;
  try {
    const command =
      process.platform === "win32"
        ? execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" })
        : execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return pattern.test(command);
  } catch {
    return false;
  }
}

function readPid(file) {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8"));
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Removes what an earlier run left behind when its runner died without
 * cleaning up (SIGKILL, a crashed terminal): kills its PocketBase and its web
 * server and deletes its data directory. A run whose runner is still alive is left alone.
 * Returns how many runs it removed.
 */
export function sweepStaleRuns(root) {
  const base = join(root, RUNS_DIR);
  if (!existsSync(base)) return 0;
  let swept = 0;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    const owner = readPid(join(dir, OWNER_PID));
    if (owner !== null && owner !== process.pid && isAlive(owner)) continue;
    const server = readPid(join(dir, SERVER_PID));
    if (server !== null && runs(server, /pocketbase/i)) process.kill(server, "SIGKILL");
    // The preview leads its own process group; take pnpm and vite together.
    const preview = readPid(join(dir, PREVIEW_PID));
    if (preview !== null && runs(preview, /vite preview/)) process.kill(-preview, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
    swept++;
  }
  return swept;
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

/**
 * Serves the web build (e2e/.output/web-dist) on a free port, in a process
 * group of its own so `stop` takes the whole pnpm > vite tree with it. Its pid
 * goes in `runDir` (the sync server's) for sweepStaleRuns. The
 * runner owns it instead of Playwright's webServer, which an interrupted
 * Playwright leaves running on its port.
 */
export async function startPreview(root, runDir) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--outDir",
      "e2e/.output/web-dist",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, env: { ...process.env, VITE_BUILD_TARGET: "web" }, stdio: "ignore", detached: true }
  );
  writeFileSync(join(runDir, PREVIEW_PID), String(child.pid));

  let stopped = false;
  const stopSync = () => {
    if (stopped) return;
    stopped = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  const stop = async () => {
    if (stopped) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      stopped = true;
      return;
    }
    const timer = setTimeout(stopSync, STOP_TIMEOUT_MS);
    if (child.exitCode === null && child.signalCode === null) await exited;
    clearTimeout(timer);
    stopSync();
  };

  const deadline = Date.now() + READY_TIMEOUT_MS * 3;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${url}/`)).ok) return { url, stop, stopSync };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stopSync();
  throw new Error(`vite preview did not serve ${url} (exit ${child.exitCode ?? "none"})`);
}
