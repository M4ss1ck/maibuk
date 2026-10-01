// The web build server both E2E runners own (issue #357): `vite preview` on
// a free port, in a process group of its own, with a run directory that the
// next run sweeps when this runner dies without cleaning up.

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/** Every preview run directory lives here, named after the runner's pid. */
export const PREVIEW_RUNS_DIR = "e2e/.output/preview";
export const OWNER_PID = "owner.pid";
export const PREVIEW_PID = "preview.pid";
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

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, owned by someone else.
    return error.code === "EPERM";
  }
}

/** Whether `pid` still runs `pattern` (vite preview), so a recycled pid is never killed. */
export function runs(pid, pattern) {
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

export function readPid(file) {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8"));
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// All process checks go through here so tests can inject fakes.
export const processProbe = {
  isAlive,
  runs,
  kill: (pid, signal) => process.kill(pid, signal),
};

/**
 * Removes what earlier runs left behind when their runner died without
 * cleaning up (SIGKILL, a crashed terminal). A run whose runner is still
 * alive is left alone. Returns how many runs it removed.
 */
export function sweepRunDirs(base, { onStale, probe = processProbe } = {}) {
  if (!existsSync(base)) return 0;
  let swept = 0;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    const owner = readPid(join(dir, OWNER_PID));
    if (owner !== null && owner !== process.pid && probe.isAlive(owner)) continue;
    onStale?.(dir, probe);
    const preview = readPid(join(dir, PREVIEW_PID));
    // The preview leads its own process group; take pnpm and vite together.
    if (preview !== null && probe.runs(preview, /vite preview/)) probe.kill(-preview, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
    swept++;
  }
  return swept;
}

export function sweepStalePreviews(root, probe = processProbe) {
  return sweepRunDirs(join(root, PREVIEW_RUNS_DIR), { probe });
}

export function createRunDir(root, runsDir) {
  const dir = join(root, runsDir, `run-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, OWNER_PID), String(process.pid));
  return dir;
}

/**
 * Serves the web build (e2e/.output/web-dist) on a free port, in a process
 * group of its own so `stop` takes the whole pnpm > vite tree with it. Its pid
 * goes in `runDir` for sweepStalePreviews. The
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

// Last resort: whatever ends the process, the servers go with it.
export function ownTeardown(stopSync) {
  let child = null;
  let interrupted = false;
  process.on("exit", stopSync);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (interrupted || !child) {
        // Second signal, or nothing to wait for: stop now.
        stopSync();
        process.exit(130);
      }
      interrupted = true;
      console.error(`\n[e2e] ${signal}: stopping Playwright, then the servers`);
      child.kill(signal);
    });
  }
  return {
    track(next) {
      child = next;
    },
  };
}

export function runPlaywright({ root, label, config, args, env, teardown }) {
  console.log(`\n[e2e] ${label}`);
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", "--config", config, ...args], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    teardown.track(child);
    child.on("exit", (status, signal) => resolve(status ?? (signal ? 130 : 1)));
    child.on("error", (error) => {
      console.error(`[e2e] playwright did not start: ${error.message}`);
      resolve(1);
    });
  });
}
